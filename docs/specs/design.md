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
- `hr_admin`(인사 근태·휴가 정정 권한)은 role과 **직교한 boolean 컬럼**이며 roleEnum은 변경하지 않는다. 부여 경로는 `HR_EMAILS` 환경변수 부트스트랩 1개뿐 — ADMIN_EMAILS와 완전 대칭으로 **승격 전용**(강등 없음, 회수는 DB 직접 수정)이고 권한 관리 UI는 만들지 않는다. 시드 스크립트의 on-conflict SET 목록에는 넣지 않으므로 시드 재실행에도 수동 부여가 보존된다(SET에 넣으면 "시드가 권한을 덮어쓴다"는 사고 경로를 새로 만든다)
- 세션 전략: JWT (DB 세션 불필요). jwt 콜백에서 매 요청 역할을 DB에서 갱신하며, **행이 삭제된 사용자는 토큰에서 신원을 제거해 fail-closed**
- hr_admin 세션 전달은 **세 지점 모두**를 배선해야 한다: jwt 콜백의 사용자 행 존재 분기에서 `token.hrAdmin = row.hrAdmin`, 행 없음(삭제) 분기에서 `delete token.hrAdmin`, session 콜백은 반드시 `if (token.dbId)` 블록 **안**에서 `session.user.hrAdmin = token.hrAdmin === true`. 하나라도 빠지면 삭제된 사용자나 배포 직후의 기존 토큰에서 권한이 샌다. `=== true`가 undefined를 false로 강제해 fail-closed이며, 행 조회는 이미 존재하므로 DB 왕복은 늘지 않는다
- 갱신 스로틀 정정: jwt 콜백의 stale 조건에 `profile?.oid` 검사가 있어 **재로그인 시에는 즉시 반영**된다. 60초(`ROLE_REFRESH_MS`) 지연은 이미 로그인된 세션에만 해당한다 — 역할·플래그 부여 후 재로그인이 확정 반영 수단이다
- 권한 플래그 확산 기준: JWT는 암호화 쿠키이고 위임 액세스·리프레시 토큰이 이미 실려 있다. 직교 플래그가 **3개를 넘으면** `user_permissions` 테이블 + `assertCapability(cap)`로 승격한다 — 그때 호출부 시그니처만 갈아끼우면 되도록 권한 가드를 순수 함수 헬퍼로 격리해 둔다
- 계정 식별은 불변 클레임 **oid(entraId)** 기준 — 이메일은 변경·재활용 가능하므로 매칭 키로 쓰지 않는다(nOAuth 방지). 토큰의 `tid`를 코드에서 재검증해 테넌트를 고정하고, `AUTH_MICROSOFT_ENTRA_ID_ISSUER` 미설정 시 로그인을 거부(fail-closed — provider의 /common 폴백 방어)

## Graph 권한 (앱 등록 #2, application)

User.ReadWrite.All, Organization.Read.All, Group.ReadWrite.All, Directory.Read.All, AuditLog.Read.All, Reports.Read.All (+ 스트레치: Calendars.ReadWrite)

## DB 스키마 (Drizzle, 초안)

- 드라이버는 `drizzle-orm/neon-serverless`(WebSocket Pool) — neon-http는 `db.transaction()`이 런타임에서 실패한다. 휴가 승인(차감 1회)·승인 게이트(실행+감사로그)의 원자성에 트랜잭션 필수
- `attendance_records`는 `(user_id, date)` 유니크 — 하루 1행 불변식을 DB에서 강제

- `users` — id, entraId(oid), email, name, department, role(admin/manager/employee), `hr_admin boolean not null default false`(인사 정정 권한 — role과 직교), managerId, annualLeaveDays(부여 연차), createdAt
- `leave_requests` — id, userId, type(annual/half/sick), startDate, endDate, days(numeric), reason, status(pending/approved_1/approved/rejected/cancelled), approverId, rejectReason, createdAt, decidedAt
- `attendance_records` — id, userId, date, checkInAt, checkOutAt, workedMinutes, note(**HR 정정 사유 슬롯**으로 용도 확정 — 다른 쓰기 경로 없음. 향후 직원이 스스로 남기는 비고 기능이 생기면 정정 사유가 덮여 쓰이므로 그때 컬럼 분리가 필요하다)
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
- HR 정정(R3.9·R4.4) 순수 함수: `isHrEditor`/`canEditRecordOf`(`src/lib/hr.ts`), `leaveBalanceWeight`/`leaveBalanceDelta`/`correctLeave`(`src/lib/leave.ts`), `kstToUtc`/`nextKstDate`/`validateAttendanceCorrection`/`MAX_SHIFT_MINUTES`(`src/lib/attendance.ts`)
- 정정 서버 액션의 실행 순서를 고정한다: **트랜잭션 시작 → before 스냅샷 읽기 → 순수 함수 검증 → 스냅샷 전체 CAS UPDATE(0행이면 실패) → 잔액 델타(WHERE 안 가드) → `tx.insert(auditLogs)`**. before를 트랜잭션 밖에서 읽으면 동시 수정 시 "이전 값"이 거짓이 되고, 잔액 가드를 앱에서 비교하면 행 락이 없어 TOCTOU가 남는다. 락 순서는 `leave_requests → users` 고정(decideLeave와 동일 — 반대면 데드락)
- 잔여 연차 재계산은 케이스 분기 없이 단일 불변식: `weight(req) = (status === "approved" && type !== "sick") ? days : 0`, `delta = weight(after) − weight(before)`. `deductionOf`(병가 0)와 팀 화면 집계 SQL(`status='approved' and type <> 'sick'`) 양쪽과 대칭이라 "총 연차 = 잔여 + 승인 사용분" 파생 등식이 보존된다. 잔여 직접 조정 UI는 만들지 않는다(`users.grantedAnnualLeaveDays` 신설이 선행 조건)
- 경합 방어는 읽은 스냅샷 전체를 CAS WHERE에 건다(휴가: status·type·days·startDate·endDate / 근태: id·checkInAt + 열린 행이면 `isNull(checkOutAt)`). 기존 `decideLeave`의 가드에도 type·days를 추가한다 — **`days`는 numeric이라 드라이버가 문자열로 돌려주므로 변환 없이 그대로 비교해야 한다(`Number()`를 끼우면 타입 불일치로 항상 0행이 되어 모든 승인·반려가 실패한다)**
- 오류 변환: `23P01` → "해당 기간과 겹치는 신청이 이미 있습니다", `23505` → "해당 날짜에 이미 근무 기록이 있습니다"
- 승인 게이트 미경유: 근태·휴가 정정은 `approval_requests`를 거치지 않는다 — 아키텍처 규칙 3의 열거 대상이 아니고 규칙 4(감사 로그)가 적용 규칙이다. 통제는 사유 필수·전/후 스냅샷·셀프 정정 금지·상태 상향 금지 4종. 감사 액션은 `attendance.correct`/`attendance.create`/`attendance.delete`, `leave.correct`/`leave.force_cancel`이며 detail은 `{ targetUserId, targetUserName, reason, before, after, balanceDelta? }`. 소프트 삭제는 도입하지 않으므로 `attendance.delete`의 before 스냅샷이 물리 삭제의 유일한 복구 근거다
- **검증 권위의 비대칭**: 휴가의 기간 겹침은 EXCLUDE 제약이 최종 권위(DB 레벨)지만, 근태의 역전·24시간 상한·미래 차단은 앱 레벨 순수 함수에만 있다. 기존 checkIn/checkOut이 만든 레거시 행이 CHECK 제약 추가 마이그레이션을 깨뜨릴 위험을 피한 선택이며, HR 경로 외의 새 쓰기 경로가 생기면 우회된다
- **경고 — `leave/page.tsx`의 거부목록(denylist) 게이트**: 열람 범위를 `role === "employee" ? [본인+같은 부서] : []`로 판정하므로, roleEnum에 값을 늘리는 순간 컴파일을 통과한 채 전사 승인 휴가가 조용히 노출된다. HR 권한을 role이 아닌 직교 플래그로 뺀 이유 중 하나이며, 향후 허용목록(allowlist)으로 뒤집을 것

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
- **HR 근태·휴가 정정은 어시스턴트 도구로 노출하지 않는다(웹 UI 전용)** — minRole 매트릭스 자체는 변경 없음. 근거: stdio 서버가 actor 없이 `executeTool`을 호출해 minRole 게이트가 건너뛰어지고, `ROLE_RANK` 선형 서열이 직교 플래그를 표현하지 못한다(Actor 타입에도 role만 있다). 노출하려면 `requiresApproval: true`가 강제되는데 이는 정정의 승인 게이트 미경유 결정과 모순되고, 전/후 확인과 사유 입력이 필요한 저빈도 액션이라 대화형 이득도 없다

## 오류 처리 원칙

- Graph 호출은 얇은 래퍼로 감싸 429(throttle) 재시도(Retry-After 존중), 403은 "권한 부족: {필요 scope}"로 변환
- 파이프라인 단계 실패는 삼키지 않는다 — 단계별 실패 상태 + 원인 노출, 이후 단계 중단
- AI 도구 실행 실패는 tool_result에 오류를 담아 모델이 사용자에게 설명하게 한다

## 테스트 전략

- 단위(Vitest): calcLicenseWaste, transitionLeave 상태머신, aggregateWeeklyMinutes(자정/주 경계), 승인 게이트(변경형 도구가 approval 없이 실행되지 않음)
- HR 정정 재정산·경계: **잔여 연차 델타 전이 매트릭스**(승인/비승인 × 연차·반차/병가 × 일수 증감 × 취소 — 동일 스냅샷은 0), **KST 역변환 경계**(자정 넘김 퇴근, 전날 귀속 정정, 1440분 상한, 미래 시각 차단), **열린 기록 쌍 불변식**(생성 시 퇴근 필수, 닫힌 행 재개방 불가, 열린 행은 출근 시각 고정), **pending이 아닌 건의 일수 증가 단방향 금지**. 기존 `transitionLeave`·`attendance`·도구 minRole 매트릭스 테스트는 **무수정 통과**가 불변식 무손상의 증명이므로 수정하지 않는다
- 시나리오: 오프보딩 파이프라인 mock Graph로 단계 실패→재시도
- E2E는 수동(실제 테넌트) + 데모 영상으로 갈음, Playwright는 스트레치
