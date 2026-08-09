# Handoff — 세션 인수인계 (2026-08-09 Phase 8 완료 기준)

새 세션은 이 문서 + [CLAUDE.md](../CLAUDE.md) + [docs/specs/tasks.md](specs/tasks.md)를 읽고 이어서 작업한다. 각 작업의 근거 스펙과 실행 프롬프트는 [docs/prompt-log.md](prompt-log.md)에 기록한다.

## 현재 상태

- **완료 (전부 커밋·푸시됨, 미커밋 변경 없음)**
  - Phase 0~6 전체 + M6 기안 + M7 포털 셸 + Phase 5 AI 어시스턴트 + Vercel 프로덕션 배포(https://workhub365-five.vercel.app)
  - **Phase 7 전체 (2026-08-09)**: 디자인 시스템 정렬 + M8 협업 6화면 + B1~B17
    - 기존 화면 정렬: 홈 4열(B7 최근 문서·B8 최근 공지 포함), 라이선스(30/60/90 세그먼트+B13 프리필 딥링크), 감사(B11 필터 탭+검색), 온보딩(칩 UI+B14 실행 이력), 어시스턴트(B16 만료 카운트+?prompt= 프리필), 결재 마스터-디테일(B12, /proposals/[id]는 ?sel= 리다이렉트), 근태·휴가 세그먼트 3탭(B17)
    - 신규 화면: 메일(B1, 3패널·text Prefer 평문), 일정(B2, 주간 그리드), 조직도(B3, 휴가 배지+프레즌스), 게시판(B4, posts/post_reads 신설+시드 12건), 문서함(B5), 회의실(B6, 감사 로그 room.book/cancel)
    - B15 전직원 개방: minRole 매트릭스, employee 본인 조회 도구 3종(actor 주입), 게이트 2중화, 사이드바·라우트 가드 완화. 게이트 테스트 확장 — **Vitest 총 169개**
    - 위임 스코프 확장 완료: `Mail.Read Calendars.ReadWrite Files.Read Presence.Read.All` — auth.ts와 delegated.ts 리프레시 scope **두 곳 동기**(주석 참조). 구세션 강등→재로그인 동의→회복까지 실검증(사용자가 세션 중 직접 재로그인·동의함)
    - Graph 클라이언트 15초 타임아웃(app-only·위임·토큰 엔드포인트) — 매달린 소켓이 single-flight 뒤에서 페이지를 5~7분 멈추던 실측 결함 수정
  - **Phase 8 — 인사(HR) 근태·휴가 정정 (2026-08-09)**: `users.hr_admin` 직교 플래그(role enum 무변경) + `HR_EMAILS` 부트스트랩 + `/attendance/manage` 4번째 탭. 서버 액션 5종(`attendance.correct`/`create`/`delete`, `leave.correct`/`force_cancel`), 순수 로직 3종(권한·근태 정정 검증·잔여 연차 델타), **Vitest 총 249개**. 실브라우저 E2E 9종 통과(조작 시도 차단 4종 포함)
- **남은 것**
  1. **프로덕션(Vercel) 반영 확인** — main 푸시로 자동 배포되지만 posts 테이블은 이미 같은 Neon DB라 추가 작업 없음. 프로덕션에서 재로그인(스코프 동의)만 하면 협업 화면이 살아난다
  2. (선택) **회의실 실예약 검증** — 앱 등록 #2에 `Place.Read.All`(application) 권한+관리자 동의 부여, M365 관리센터에서 리소스 사서함(회의실) 생성 → /rooms가 가용성 그리드로 전환. 현재는 권한 안내 카드 강등(정상 설계 경로)
  3. (선택) **employee 계정 실브라우저 E2E** — B15 게이트는 테스트 169개로 커버되지만 화면 확인은 안 함: 데모 계정(예: dev1) 로그인 → 사이드바 AI 표시, 도구 3종만, "내 연차 며칠 남았어?" 실행, admin 도구 미노출 확인
  4. **데모 영상 녹화**(docs/demo-script.md — Phase 7 화면 반영해 대본 갱신 필요할 수 있음) — **E3 평가판 만료(8월 말경) 전에!**
  5. (선택) M3 스트레치(승인 시 Outlook 이벤트 생성)

## 이 대화에서만 알 수 있는 것 (재발 방지·컨텍스트)

### Phase 8 (인사 정정)에서 얻은 것

- **근태 세그먼트에는 layout.tsx가 없었다** — page.tsx가 h1과 탭을 직접 렌더하고 있어서, 새 탭 라우트(`/attendance/manage`)가 셸을 상속받지 못하고 "들어가면 돌아올 수 없는 화면"이 될 뻔했다. `attendance/layout.tsx`를 leave 쪽과 동형으로 신설하고 page.tsx에서 h1·탭을 제거해 해결. 탭 활성 판정도 `startsWith` → exact로 바꿨다(안 그러면 `/attendance/manage`에서 `aria-current`가 두 개 붙는다)
- **열린 근태 기록의 출근 시각을 잠근 이유** — 잠그지 않으면 인사팀이 출근을 며칠 전으로 옮긴 뒤 직원이 퇴근 버튼을 누르는 순간, 기존 `checkOut` 액션(`attendance/actions.ts`)이 상한 없이 `workedMinutesBetween(open.checkInAt, now)`을 저장해 수천 분이 기록된다. 신규 기능의 안전성이 기존 코드의 허점에 걸려 있던 지점. E2E에서 devtools로 `disabled`를 풀고 조작 제출까지 해봤고 서버가 DB 값을 강제하는 것을 확인했다
- **`decideLeave`의 `days` 비교에 `Number()`를 끼우면 안 된다** — numeric(4,1)이라 드라이버가 문자열로 돌려주는데 변환하면 타입 불일치로 CAS가 항상 0행이 되어 **모든 승인·반려가 실패**한다. 가드 확장 후 실제 승인을 실행해 회귀가 없음을 확인했다(잔여 16.0 → 11.0)
- **시드 재실행 내성** — `seed-leave-demo.mjs`의 on-conflict SET 목록에 `hr_admin`이 없어서 수동 부여가 보존된다. 반대로 `annual_leave_days`는 SET에 **있어서** 시드가 잔여 연차를 리셋한다 — 그래서 "잔여 연차 직접 조정" 기능은 넣지 않았고(넣었다면 시드가 조용히 되돌림), 데모는 반드시 시드 → 정정 순서로 해야 한다
- **잔여 연차는 델타가 아니라 무게 재계산으로** — `weight(req) = approved && 비병가 ? days : 0`을 정의하고 `after - before`를 적용한다. 전이별 if 분기는 유형과 일수가 동시에 바뀌는 조합에서 반드시 빠진다. 이 식이 팀 화면의 집계 SQL과 대칭이라 "총 연차 = 잔여 + 승인 사용분" 등식이 보존된다(E2E에서 승인→축소→취소 전 과정 17로 고정 확인)
- 인사 권한을 role enum이 아니라 직교 컬럼으로 둔 실증 근거: 데모 테넌트의 정도윤은 `인사` 부서 **manager**다. enum에 `hr`를 더했다면 결재권과 인사권 중 하나를 포기해야 했다

### Phase 7 이하

- **목업 분석 문서 유실 사건**: design-system.md·feature-map.md가 빈 파일로 커밋됐던 것을 목업 HTML+스펙에서 재구성함(1d62f79). B 번호는 handoff 참조(B11~B15)를 고정점으로 재부여 — [docs/mockup/feature-map.md](mockup/feature-map.md)가 이제 화면별 구현 스펙의 진실
- **/places는 Place.Read.All 미부여 시 메시지 없는 401**(403 아님) — rooms.ts가 권한 안내로 변환한다. 또 401을 받으면 graphFetch가 앱 토큰을 폐기·재발급하는데, 토큰 엔드포인트로 가는 소켓이 고착되면 single-flight 뒤에서 전부 멈춘다 → 15초 타임아웃이 방어(60a84a2)
- **스코프 확장은 두 곳**: auth.ts(로그인)과 delegated.ts(리프레시) — 리프레시가 미동의 스코프를 요구하면 consent_required로 실패해 null(강등) 반환. 이 강등이 "기존 세션 위젯 강등" 경로의 실체
- **OneDrive 첫 접근은 콜드 프로비저닝**으로 15초 타임아웃이 날 수 있음 — 재시도하면 성공(문서함에서 실측)
- 결재 B12: 마스터 목록은 본인/결재선 것만 노출하지만 최종 방어는 proposal-detail.tsx의 자체 권한 검사(기안자/결재선/admin 외 폴백) — ?sel= 임의 UUID 시도는 폴백 카드
- 게시판 조회수는 중복 방지 없음(데모 수준, design.md 명시), 댓글·SharePoint 문구는 스펙 제외 항목
- 어시스턴트 승인 카드 만료 카운트는 표시일 뿐 — 만료 판정 진실은 서버 canDecide(변경 금지)
- 데모 계정 세션 철회(revoke_user_sessions)가 승인 플로 E2E에 무해해 적합. 이번 세션에서 라이선스 회수 승인 카드 12건 생성→1건 거부·11건 자연 만료(실행 0건 — 불변식 확인)
- Neon 커넥션 고갈(53300)이 db:push+시드+병렬 렌더가 겹치면 발생 가능 — dev 서버 재시작으로 해소
- **Vercel 배포 시 유의**: 15초 타임아웃은 GraphError(504)로 흐른다. `/api/assistant` maxDuration 180 유지

## 환경·운영 정보

- **개발 서버**: `.claude/launch.json`의 `dev` (preview로 실행, Bash 금지)
- **로그인**: admin 계정은 확장 스코프 동의 완료. 다른 데모 계정은 첫 로그인 시 동의 화면. 브라우저에 MS 세션이 살아있으면 로그인 버튼만으로 자동 SSO
- **테넌트**: workhub0109.onmicrosoft.com, E3 25석 평가판(8월 말 만료 추정). admin 계정은 Graph 프로필에 부서가 비어 있어 조직도에서 '부서 미지정'으로 묶인다
- **DB**: Neon(us-east-2, -pooler) — `npx drizzle-kit push --force`(TTY 없음) + `node --env-file=.env.local scripts/apply-manual-migrations.mjs`. 게시판 시드: `node --env-file=.env.local scripts/seed-board-demo.mjs`(재실행 시 리셋)
- **데모 데이터**: scripts/seed-demo-users.mjs, seed-leave-demo.mjs, seed-board-demo.mjs. 비밀번호는 demo-users.local.json(gitignore)
- **Wiki**: https://github.com/kws0109/workhub365.wiki.git 새로 clone해 Development-Log.md 추가 후 push

## 작업 관행 (이 리포의 리듬)

- **사이클**: 구현 → 순수 로직 단위 테스트 → build/lint → 실브라우저 E2E → 2-렌즈 병렬 리뷰(정확성·컨벤션) → 결함 수정 → 논리 단위 커밋(한국어, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`) → push → Wiki 일지
- UI: 시맨틱 토큰(line/fill/surface/ink-*)만, 무섀도, 공용 컴포넌트(ui.tsx — Card/StatTile/Badge/SourceChip/Avatar/PageHeader/TabLink/tabClass/FileTypeIcon/ProgressBar) 재사용, 서버 액션 {error}+ActionForm, 페이지 쿼리 병렬 스테이지, 부서 의존은 상관 서브쿼리
- 쓰기 UX는 딥링크 위임이 원칙 — 유일한 예외는 회의실 예약(Calendars.ReadWrite)
- 동시성: 조건부 UPDATE(CAS), 불변식은 DB 제약, 감사 로그는 트랜잭션 안

## 대화에서만 알 수 있는 함정 (기존 누적분 — 유효)

- drizzle `sql\`(select ... from ${table})\`` 원시 서브쿼리 렌더링 어긋남 — leftJoin+groupBy 또는 쿼리 빌더 서브쿼리로
- 브라우저 자동화 form_input은 date input에 문자 단위 입력 — E2E는 JS click/검증 병행
- 성능 측정은 전체 HTML fetch(no-store, 워밍업 2회)
- `.env.local` 키가 줄바꿈 없이 붙으면 dotenv가 조용히 무시
- drizzle-kit push는 TTY 없으면 대화형에서 죽음 — `--force`
- 클릭 셀 `<button>`의 UA 세로 정렬이 레이아웃 깨뜨림 — flex-col justify-start
- tsx는 CJS 변환이라 stdio 엔트리는 async main() 패턴 (top-level await 금지)
- 어시스턴트 채팅은 마크다운 미렌더링 — 시스템 프롬프트에서 평문 지시 유지
- 스트림 중단 시 이력 끝 미완결 tool_use 롤백(chat.tsx repairHistory) — 다음 요청 400 방지
