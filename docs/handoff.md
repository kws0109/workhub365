# Handoff — 세션 인수인계 (2026-08-09 Phase 6 문서·CI 완료 기준)

새 세션은 이 문서 + [CLAUDE.md](../CLAUDE.md) + [docs/specs/tasks.md](specs/tasks.md)를 읽고 이어서 작업한다. 각 작업의 근거 스펙과 실행 프롬프트는 [docs/prompt-log.md](prompt-log.md)에 기록한다 (새 작업도 같은 형식으로 기록할 것).

## 현재 상태

- **완료 (전부 실테넌트/실브라우저 E2E 검증 + 커밋·푸시됨, 미커밋 변경 없음)**
  - Phase 0~1: 스캐폴드, Entra SSO(2층 인증), Graph 클라이언트, DB 기반
  - M1 라이선스 대시보드 / M2 온보딩·오프보딩(NDJSON 스트리밍 파이프라인) / M3 휴가(캘린더 클릭→모달, 공휴일 자동수집, 팀 연차 탭) / M4 근태 / M6 기안(전자결재: 템플릿 4종, 자동 결재선, 순차 결재)
  - 다중 사용자 동시성 강화 (EXCLUDE 제약, 풀 하드닝, after() 등) + 성능 최적화 (쿼리 병렬화, Graph TTL 캐시, jwt 스로틀)
  - M7 포털 셸 (2026-08-09): 사이드바 섹션 그룹핑+아이콘+기안 미결 배지+M365 딥링크 런처(R7.1~R7.3), 홈 대시보드 위젯 그리드(R7.4 — 근무 카드·타일 3종·내 기안·admin 낭비 KPI/감사 로그 + M365 위젯: 안읽은 메일·오늘 일정, 위임 토큰 서버 전용 처리)
  - Phase 5 / M5 AI 어시스턴트 (2026-08-09): `packages/mcp-server` 도구 10종(단일 소스, stdio 서버 겸용) + `/api/assistant` tool use 루프(NDJSON) + 승인 카드(pending→executing CAS 클레임, 멱등 키, 만료 15분) + 게이트 시나리오 테스트. 실브라우저 E2E: 조회 3종·승인→Graph 실행·거부·감사 로그 4종. 구현 결정·트레이드오프는 design.md M5 절에 기록
  - Phase 6 문서·CI (2026-08-09): GitHub Actions CI(lint+test+build, 시크릿 불필요 — 첫 실행 통과), README 전면 보강(mermaid 2종·의사결정 표·CI 배지), Wiki 현행화, docs/deploy.md(Vercel 절차), docs/demo-script.md(장면 7개 대본)
  - Vercel 프로덕션 배포 (2026-08-09): **https://workhub365-five.vercel.app** — SSO 로그인·홈 위젯(위임 메일 포함)·라이선스 Graph·어시스턴트 승인 게이트 전체 플로·감사 로그 실검증 완료. 첫 배포에서 AUTH_URL이 localhost 기본값 그대로라 로그인 리디렉션이 localhost로 돌아가는 문제 발생 → 환경변수 수정+Redeploy로 해결(deploy.md 함정 절 기록)
- **남은 것**: ① 데모 영상 녹화(대본 docs/demo-script.md) — E3 평가판 만료(8월 말경) 전에! (사용자 액션) ② (선택) M7 모바일 드로어, M3 스트레치
- 검증 상태: Vitest 96개 통과, lint/build 클린, CI 녹색, MCP stdio JSON-RPC 실검증, 프로덕션 체크리스트 통과

## 남은 작업 착수 시 알아야 할 것

- Vercel: 시크릿 없이 빌드 통과 확인됨(.env.local 제거 빌드로 검증) — 임포트만 하면 빌드는 성공, 기능은 환경변수 등록 후. `/api/assistant` `maxDuration 180`은 기본 한도(300) 안
- MCP stdio 독립 실행: `npm run mcp:stdio` — tsx가 `--conditions=react-server`로 `server-only`를 우회한다(플래그 제거하면 즉시 깨짐)
- 어시스턴트 E2E 재검증 시: 데모 계정 세션 철회(`revoke_user_sessions`)가 무해해서 승인 플로 테스트에 적합. 오하린(fin2) 세션은 Phase 5 검증에서 이미 철회됨
- 2-렌즈 리뷰에서 수용한 잔여 한계(수정 안 함): 대화 이력 80메시지 초과 시 '새 대화' 안내로 해소(자동 트리밍 없음), executing 잔류 행 수동 정리(리퍼 없음 — design.md M5 트레이드오프 참조)

## 환경·운영 정보

- **개발 서버**: `.claude/launch.json`의 `dev` 설정 (preview로 실행, Bash로 띄우지 말 것)
- **로그인**: 브라우저 세션 쿠키가 초기화되면 사용자에게 Microsoft SSO 재로그인을 요청해야 함 (자격 증명 입력은 대신 못 함). 2026-08-09부터 SSO가 위임 스코프(Mail.Read·Calendars.Read·offline_access)를 요청 — admin 계정은 동의 완료, 다른 데모 계정은 첫 로그인 시 동의 화면이 뜸
- **테넌트**: `workhub0109.onmicrosoft.com`, Microsoft 365 E3 25석 (평가판 — 만료 전 데모 확보 필요), 관리자 김 우성(admin, 부서 개발)
- **DB**: Neon(us-east-2, -pooler) — 스키마는 `npm run db:push` + `node --env-file=.env.local scripts/apply-manual-migrations.mjs`(EXCLUDE 제약 등)
- **데모 데이터**: `scripts/seed-demo-users.mjs`(테넌트 사용자), `scripts/seed-leave-demo.mjs`(팀·휴가 리셋). 데모 계정 비밀번호는 `demo-users.local.json`(gitignore)
- **Wiki**: `https://github.com/kws0109/workhub365.wiki.git`을 새로 clone해서 Development-Log.md에 추가 후 push (이전 세션의 clone 경로는 세션 스크래치패드라 사라짐). 모듈 완료마다 개발 일지 기록이 관행

## 작업 관행 (이 리포의 리듬)

- **사이클**: 구현 → 순수 로직 단위 테스트 → build/lint → 실브라우저 E2E → 2-렌즈 병렬 리뷰 → 결함 수정 → 논리 단위 커밋(한국어, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`) → push → Wiki 일지
- UI 관행: zinc 라이트 테마, 서버 액션은 `{error}` 반환 + `ActionForm`(useActionState), 페이지 쿼리는 병렬 스테이지로(원격 DB 왕복 ~200ms), 부서 의존은 상관 서브쿼리
- 동시성 관행: 조건부 UPDATE(CAS) 전이, 불변식은 DB 제약, 감사 로그는 트랜잭션 안에서

## 대화에서만 알 수 있는 함정 (재발 방지)

- drizzle에서 `sql\`(select ... from ${table} alias ...)\`` 원시 서브쿼리는 렌더링이 어긋날 수 있음 — leftJoin+groupBy 또는 쿼리 빌더 서브쿼리를 쓸 것 (기안 목록에서 1회 발생)
- 브라우저 자동화 `form_input`은 date input에 문자 단위 입력 → 중간값으로 onChange가 여러 번 발화 + Enter 제출 아티팩트 — E2E는 JS click/검증 병행이 안전
- 성능 측정은 RSC 헤더 fetch가 아니라 전체 HTML fetch(no-store, 워밍업 2회 후)로
- `.env.local`은 키가 줄바꿈 없이 붙으면 dotenv가 조용히 무시 — 키 파싱 검증 스크립트로 확인
- drizzle-kit push는 TTY 없으면 대화형 확인에서 죽음 — 변경 내용 확인 후 `--force`
- 셀을 클릭 요소로 만들 때 `<button>`의 UA 세로 중앙 정렬이 레이아웃을 깨뜨림(캘린더에서 발생) — flex-col justify-start 강제
- tsx는 `"type": "module"` 없는 리포에서 .ts를 CJS로 변환 — top-level await가 빌드 에러. stdio 엔트리는 async main() 패턴으로
- 어시스턴트 채팅은 마크다운을 렌더링하지 않음 — 시스템 프롬프트에서 평문 출력을 지시(표·굵게 금지). 지시 없으면 `**`·표 구문이 그대로 노출됨
- 대화 이력의 tool_use/tool_result 페어링: 스트림이 도중 끊기면 이력 끝의 미완결 tool_use를 롤백해야 다음 요청이 400으로 죽지 않음 (chat.tsx repairHistory)
