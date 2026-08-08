# Handoff — 세션 인수인계 (2026-08-09 기준)

새 세션은 이 문서 + [CLAUDE.md](../CLAUDE.md) + [docs/specs/tasks.md](specs/tasks.md)를 읽고 이어서 작업한다. 각 작업의 근거 스펙과 실행 프롬프트는 [docs/prompt-log.md](prompt-log.md)에 기록한다 (새 작업도 같은 형식으로 기록할 것).

## 현재 상태

- **완료 (전부 실테넌트/실브라우저 E2E 검증 + 커밋·푸시됨, 미커밋 변경 없음)**
  - Phase 0~1: 스캐폴드, Entra SSO(2층 인증), Graph 클라이언트, DB 기반
  - M1 라이선스 대시보드 / M2 온보딩·오프보딩(NDJSON 스트리밍 파이프라인) / M3 휴가(캘린더 클릭→모달, 공휴일 자동수집, 팀 연차 탭) / M4 근태 / M6 기안(전자결재: 템플릿 4종, 자동 결재선, 순차 결재)
  - 다중 사용자 동시성 강화 (EXCLUDE 제약, 풀 하드닝, after() 등) + 성능 최적화 (쿼리 병렬화, Graph TTL 캐시, jwt 스로틀)
  - M7 포털 셸 1차 (2026-08-09): 사이드바 섹션 그룹핑+아이콘, 기안 미결 배지(승인 후 소멸까지 E2E 검증), M365 앱 딥링크 런처 — 스펙 R7.1~R7.3
- **남은 것**: Phase 5 (M5 AI 어시스턴트 + MCP 서버), M7 후속(R7.4 홈 대시보드 위젯 그리드, 모바일 드로어), Phase 6 (CI, README 정리, Vercel 배포, 데모)
- 검증 상태: Vitest 65개 통과, lint/build 클린
- M7 설계 주의: 실시간 숫자는 홈 대시보드에만, 레이아웃 배지는 revalidate 스냅샷 (이유는 design.md M7 절) — M365 화면 iframe 임베드는 금지 결정

## Phase 5 착수 시 알아야 할 것

- 설계는 [design.md](specs/design.md) M5 절 참조: Claude API tool use 루프, 도구는 `packages/mcp-server`로 분리(in-process + stdio 겸용), 변경형 도구는 `approval_required` → 승인 카드 → 실행
- `approval_requests` 테이블은 스키마에 이미 있으나 **동시성 리뷰 지적 미반영**: 실행-정확히-1회를 위해 `executing` 클레임 상태·idempotency 키·만료가 필요 — Phase 5에서 스키마 보강할 것
- `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL`(claude-sonnet-5)은 `.env.local`에 이미 설정됨
- 절대 불변식(CLAUDE.md 3번): 파괴적 액션은 승인 게이트 우회 불가 — 시나리오 테스트 필수

## 환경·운영 정보

- **개발 서버**: `.claude/launch.json`의 `dev` 설정 (preview로 실행, Bash로 띄우지 말 것)
- **로그인**: 브라우저 세션 쿠키가 초기화되면 사용자에게 Microsoft SSO 재로그인을 요청해야 함 (자격 증명 입력은 대신 못 함)
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
