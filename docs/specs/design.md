# WorkHub365 설계

## 전체 구조

```
브라우저 ──(Entra ID SSO)── Next.js App Router (Vercel)
                              ├─ Server Components / Server Actions
                              ├─ src/lib/graph/   ← app-only Graph 클라이언트 (서버 전용)
                              ├─ src/lib/*        ← 순수 비즈니스 로직 (단위 테스트 대상)
                              ├─ src/db/          ← Drizzle ORM ── Neon Postgres
                              └─ /api/assistant   ← Claude API tool use 루프
                                    └─ packages/mcp-server ← 관리 도구 MCP 서버 (in-process + 독립 실행)
```

## 인증 2층

| 층 | 용도 | 방식 | 자격 증명 |
|---|---|---|---|
| 사용자 SSO | 직원 로그인, 역할 판별, 본인 메일·일정 위젯(M7) | Auth.js(NextAuth) + Microsoft Entra ID provider (delegated, openid/profile/email/User.Read/Mail.Read/Calendars.Read/offline_access) | 앱 등록 #1 |
| 관리 액션 | Graph 관리 호출 | client credentials(app-only), `.default` scope + admin consent | 앱 등록 #2 |

- 역할(admin/manager/employee)은 DB `users.role`에 저장. 최초 로그인 시 employee로 생성, 승격은 admin이 수행(부트스트랩: `ADMIN_EMAILS` 환경변수에 나열된 계정은 **매 로그인마다** 평가해 admin으로 승격 — 최초 가입 시에만 적용하면 데드락)
- 세션 전략: JWT (DB 세션 불필요). jwt 콜백에서 매 요청 역할을 DB에서 갱신하며, **행이 삭제된 사용자는 토큰에서 신원을 제거해 fail-closed**
- 계정 식별은 불변 클레임 **oid(entraId)** 기준 — 이메일은 변경·재활용 가능하므로 매칭 키로 쓰지 않는다(nOAuth 방지). 토큰의 `tid`를 코드에서 재검증해 테넌트를 고정하고, `AUTH_MICROSOFT_ENTRA_ID_ISSUER` 미설정 시 로그인을 거부(fail-closed — provider의 /common 폴백 방어)

## Graph 권한 (앱 등록 #2, application)

User.ReadWrite.All, Organization.Read.All, Group.ReadWrite.All, Directory.Read.All, AuditLog.Read.All, Reports.Read.All (+ 스트레치: Calendars.ReadWrite)

## DB 스키마 (Drizzle, 초안)

- 드라이버는 `drizzle-orm/neon-serverless`(WebSocket Pool) — neon-http는 `db.transaction()`이 런타임에서 실패한다. 휴가 승인(차감 1회)·승인 게이트(실행+감사로그)의 원자성에 트랜잭션 필수
- `attendance_records`는 `(user_id, date)` 유니크 — 하루 1행 불변식을 DB에서 강제

- `users` — id, entraId(oid), email, name, department, role(admin/manager/employee), managerId, annualLeaveDays(부여 연차), createdAt
- `leave_requests` — id, userId, type(annual/half/sick), startDate, endDate, days(numeric), reason, status(pending/approved_1/approved/rejected/cancelled), approverId, rejectReason, createdAt, decidedAt
- `attendance_records` — id, userId, date, checkInAt, checkOutAt, workedMinutes, note
- `audit_logs` — id, actorId, actorType(user/assistant), action, targetType, targetId, detail(jsonb), success, createdAt
- `approval_requests` — id, kind(assistant_action), payload(jsonb), status(pending/approved/rejected/executed/failed), requestedBy, decidedBy, createdAt, decidedAt — AI 승인 카드용
- `sku_prices` — skuId, skuPartNumber, displayName, monthlyPriceKrw — 낭비 금액 환산 단가표

상태 전이(휴가): `pending → approved_1 → approved` (2단계 결재선일 때) / `pending → approved` (1단계) / 어느 단계든 `→ rejected`, 신청자 취소는 pending 단계에서만 `→ cancelled`. 잔여 연차 차감은 `approved` 진입 시 1회만.

## 모듈별 설계 요점

### M1 라이선스 대시보드
- 서버에서 `/subscribedSkus` + `/users?$select=...,signInActivity,assignedLicenses` 페이징 수집 → 메모리 조인
- 낭비 계산 순수 함수: `calcLicenseWaste(users, skus, prices, inactiveDays)` → { 사용자별 낭비, SKU별 합계, 총액 }
- signInActivity는 Entra P1 필요(E5 평가판 포함) — 실패 시 "마지막 로그인 알 수 없음"으로 강등 처리(기능 전체를 죽이지 않음)

### M2 온보딩/오프보딩
- 파이프라인 정의를 데이터로: `[{ key, label, run(ctx) }]` 배열 — 단계 추가/재시도가 쉬움
- 실행 상태를 클라이언트에 스트리밍(Server Action + revalidate 또는 route handler streaming)
- 온보딩 입력: 이름, 이메일 prefix, 부서, 라이선스 SKU 선택, 그룹 다중 선택
- 임시 비밀번호: Graph passwordProfile(forceChangePasswordNextSignIn: true)

### M3 휴가 / M4 근태
- 핵심 로직 순수 함수화: `transitionLeave(request, action, actor)`, `aggregateWeeklyMinutes(records, weekStart)`, `detectOvertime(weeklyMinutes, limit)`
- KST 주 경계(월요일 00:00 KST) 기준 집계 — UTC 저장, 집계 시 변환

### M5 AI 어시스턴트
- 루프: 사용자 메시지 → Claude API(tools) → tool_use → 서버에서 실행 → tool_result → … → 최종 응답
- 도구 정의는 `packages/mcp-server`에 단일 소스로 두고, Next.js에서는 in-process로 import, 외부에선 stdio MCP 서버로도 실행 가능
- 도구 분류: 조회형(즉시 실행) vs 변경형(`requiresApproval: true`)
- 변경형 흐름: tool 실행 요청 → `approval_requests`에 payload 저장 + `approval_required` 반환 → 채팅 UI에 승인 카드 → 승인 시 서버가 실제 실행 → 결과를 대화에 반영
- 모델: `claude-sonnet-5` 기본(비용), 환경변수로 교체 가능
- **게이트 강제 구조**: 실행 유일 진입점 `executeTool`이 `approvalGranted` 없이는 변경형을 실행하지 않는다. `approvalGranted`를 전달하는 유일한 코드는 승인 카드 서버 액션이며, `pending → executing` 조건부 UPDATE(CAS) 클레임 성공 후에만 실행한다 — 동시 승인이 이중 실행되지 않는다(실행-정확히-1회). stdio 서버는 `approvalGranted`를 절대 전달하지 않으므로 외부 MCP 클라이언트는 변경형을 실행할 수 없다
- **멱등·만료**: 승인 요청은 Claude tool_use 블록 id를 멱등 키로 사용(스트림 재시도에도 1건), 만료 15분(만료된 pending은 클레임 조건에서 차단)
- **알려진 트레이드오프**: 클레임 후 실행 도중 프로세스가 죽으면 행이 `executing`으로 잔류하고 재승인은 불가 — 이중 실행 방지를 우선한 결정. 실행 후 기록 실패는 개별 재시도(감사 로그 불변식 4 보전) + 경고 반환으로 완화
- **비밀 취급**: 임시 비밀번호는 `approval_requests.result`·감사 로그·모델 컨텍스트에 저장하지 않고 승인 응답에서 1회만 표시. `create_user`는 계정 생성 이후 단계(라이선스/그룹)의 부분 실패를 허용해 비밀번호 유실을 막는다
- **대화 이력**: 서버 무상태 — 클라이언트가 Anthropic 원본 블록(thinking 포함)을 보관·왕복하고, 스트림 중단 시 미완결 tool_use를 롤백해 tool_result 페어링 400을 방지

### M6 기안(전자결재)
- 템플릿(유형별 필드+기본 결재선 규칙)은 코드가 진실의 원천(`src/lib/proposal.ts`), 제출값은 jsonb 스냅샷 — **상세 화면은 스냅샷 기준으로 렌더링**하고 템플릿은 라벨/순서 메타데이터로만 사용 (템플릿 진화에도 기존 문서 보존)
- 순차 결재: 조건부 전이(내 결재 행 대기 + 기안 동일 단계)로 동시 결재 이중 처리 차단. 회수는 `in_progress AND currentStep=1` 조건부 UPDATE — 동시 승인과의 TOCTOU 봉쇄
- **열람 정책**: 작성자·결재선 구성원 + 관리자(감독·복구 목적). 결재·회수 권한은 관리자에게 없음
- **회복 경로**: 결재자 퇴사 등으로 멈춘 기안은 관리자가 사유 필수 강제 반려 가능 (`proposal.force_reject` 감사 로그)
- 백로그: 결재자 후보에서 비활성(오프보딩) 사용자 제외, 관리자 열람 감사 로그, 결재자 재지정

### M7 포털 셸 (사이드바)
- 사이드바는 클라이언트 컴포넌트 유지(usePathname 활성 표시). 미결 건수는 `(app)` 레이아웃(서버)에서 결재함과 동일 조건(내 차례 step=currentStep, pending, 기안 in_progress)으로 count 조회해 prop으로 전달 — 레이아웃과 페이지는 병렬 렌더링되므로 DB 왕복 1회가 페이지 로드 지연에 가산되지 않음
- 배지 신선도: 레이아웃은 클라이언트 내비게이션 간 재렌더링되지 않으므로 배지는 스냅샷. 결재 서버 액션의 revalidatePath 덕에 액션 직후에는 일관되고, 외부 이벤트(타인의 상신)는 다음 하드 로드에 반영 — 의도된 트레이드오프. 정확한 실시간 숫자가 필요한 위젯은 매 방문 렌더링되는 홈 대시보드에만 둔다
- 아이콘은 외부 라이브러리 없이 인라인 SVG(stroke 1.5, currentColor) — 의존성 최소화
- M365 딥링크는 테넌트 무관 URL 상수(outlook.office.com/mail 등), `target="_blank" rel="noopener noreferrer"`. iframe 임베드 금지(R7 원칙)
- 홈 대시보드(R7.4): 위젯 데이터는 단일 병렬 스테이지(Promise.all), 미결 건수는 `countMyTurnProposals`(src/lib/proposal-queries.ts, React cache로 레이아웃과 요청당 1회 공유). admin 위젯(낭비 KPI+감사 로그)은 Graph 호출이 느릴 수 있어 Suspense로 스트리밍하고, Graph 실패 시 해당 위젯만 오류 강등(페이지 전체를 죽이지 않음). 출퇴근 액션은 근태 화면과 동일 서버 액션 재사용 + `revalidatePath("/")` 추가
- M365 위젯(안읽은 메일·오늘 일정): 위임 스코프 `Mail.Read`·`Calendars.Read`·`offline_access`로 구현. **위임 토큰은 Auth.js JWT(암호화 쿠키)에만 보관하고 session 콜백에는 싣지 않는다** — session에 실으면 `/api/auth/session`으로 브라우저에 노출된다. 읽기는 서버 전용 `lib/graph/delegated.ts`가 쿠키를 직접 복호화(`next-auth/jwt` decode, salt=쿠키명, `.0/.1` 청크 재조립). 만료 시 리프레시 토큰으로 갱신하되 RSC에서는 쿠키 재기록이 불가하므로 결과는 oid 키 인메모리 캐시로 재사용. 갱신 실패·구세션(스코프 없음)은 null → 위젯이 "재로그인 안내"로 강등되고 페이지는 계속 동작. app-only 토큰으로 개인 메일을 읽는 것은 인증 2층 원칙 위반이므로 금지

### 디자인 시스템 (2026-08-09 — 사용자 제공 목업 채택)

- **진실의 원천**: 사용자 제공 목업(클로드 아티팩트). 추출된 토큰·컴포넌트 규격은 `src/app/globals.css`의 `@theme`이 단일 소스
- 방향: **라이트 단일, 무섀도** — 깊이는 보더(`zinc-200`)+배경 대비로만. 카드 radius 12px/컨트롤 8px/필 999px. 포인트 컬러는 모노크롬(`zinc-900` = primary), 상태색은 Tailwind 기본(emerald/amber/red/blue) 그대로
- 타이포: Geist 400~700(기존 next/font 유지, 한글 폴백 스택 명시), 숫자는 전부 `tabular-nums`, 큰 제목 `tracking -0.02em`. 모노는 기술 식별자(액션명·JSON·도구명) 전용
- 셸: 흰 사이드바 224px(섹션 4개: 내 업무/협업/AI/관리 + M365 링크 + 사용자 푸터), 상단 헤더 없음, 콘텐츠 패딩 32px·페이지별 max-width(920~1240)
- 아이콘: 인라인 SVG stroke 1.5 현행 유지 (외부 라이브러리 미도입)
- 공용 컴포넌트로 추출: Card, StatTile, Badge, SourceChip(연동 출처), Avatar(이니셜+프레즌스), 테이블 행 패턴

### M8 협업 (2026-08-09)

- **위임 스코프 확장**: `Mail.Read`(기존)·`Calendars.ReadWrite`(Read에서 승격 — 회의실 예약용)·`Files.Read`·`Presence.Read.All` 추가. 기존 세션은 위젯 강등 → 재로그인 동의로 회복(M7 위임 토큰 경로 재사용)
- 메일/일정/문서함/최근문서: `lib/graph/delegated.ts` 경유 읽기 전용. 각 화면은 토큰 없음/스코프 부족 시 재로그인 안내 카드로 강등
- 조직도: app-only `getDirectoryUsers()` 부서 그룹핑 + 오늘 승인 휴가(leave_requests) 조인 배지. 프레즌스는 위임 `/communications/getPresencesByUserId` 배치 조회(100명 상한), 실패 시 회색
- 게시판: 신규 테이블 `posts`(카테고리 enum, pinned, mustRead, viewCount) + `post_reads`(필독 확인 이력, (postId,userId) 유니크). 조회수는 상세 열람 시 increment(중복 방지 없음 — 데모 수준 명시)
- 회의실: app-only `/places/microsoft.graph.room` 목록 + 위임 `getSchedule` 가용성 + 위임 이벤트 생성(회의실 attendee, `Calendars.ReadWrite`). 리소스 사서함 0개면 세팅 가이드 카드로 강등
- **메신저 제외 근거**: Teams 채팅 본문 protected API(CLAUDE.md 알려진 제약). 자체 DB 채팅은 "M365 위에 얹는다" 정체성에 반해 만들지 않는다
- M5 전직원 개방: MCP 도구에 `minRole`(employee|manager|admin) 부여, `/api/assistant`가 세션 역할로 도구 목록 필터 + `executeTool`에 역할 게이트 2중화. employee용 신규 조회 도구(내 연차·내 주간 근무·내 기안 현황)는 actor 컨텍스트(userId) 주입 — 타인 정보 조회 불가를 게이트 테스트에 추가

## 오류 처리 원칙

- Graph 호출은 얇은 래퍼로 감싸 429(throttle) 재시도(Retry-After 존중), 403은 "권한 부족: {필요 scope}"로 변환
- 파이프라인 단계 실패는 삼키지 않는다 — 단계별 실패 상태 + 원인 노출, 이후 단계 중단
- AI 도구 실행 실패는 tool_result에 오류를 담아 모델이 사용자에게 설명하게 한다

## 테스트 전략

- 단위(Vitest): calcLicenseWaste, transitionLeave 상태머신, aggregateWeeklyMinutes(자정/주 경계), 승인 게이트(변경형 도구가 approval 없이 실행되지 않음)
- 시나리오: 오프보딩 파이프라인 mock Graph로 단계 실패→재시도
- E2E는 수동(실제 테넌트) + 데모 영상으로 갈음, Playwright는 스트레치
