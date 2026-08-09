# WorkHub365

M365 위에 얹히는 경량 그룹웨어 + 관리 자동화. Next.js App Router(TS) + Microsoft Graph API + Claude AI 어시스턴트.

## 명령어

- `npm run dev` — 개발 서버 (Turbopack)
- `npm run build` — 프로덕션 빌드
- `npm run lint` — ESLint
- `npm test` — Vitest 단위 테스트 (Phase 2에서 도입 — 낭비 계산 순수 함수와 함께 들어왔다)

## 아키텍처 규칙 (위반 금지)

1. **Graph API 호출은 서버 전용.** `src/lib/graph/` 안에서만 호출한다. 클라이언트 컴포넌트에서 Graph SDK를 import하지 않는다. app-only 토큰(client credentials)은 절대 브라우저로 내려보내지 않는다.
2. **인증은 2층 구조를 유지한다.** ① 사용자 SSO = Auth.js + Entra ID(delegated) ② 관리 액션 = app-only client credentials. 두 자격 증명을 섞지 않는다.
3. **되돌리기 어려운 액션은 승인 게이트를 통과해야 한다.** 계정 차단·삭제, 라이선스 회수, 세션 철회, 그룹 제거는 AI 어시스턴트가 직접 실행할 수 없고, 반드시 `approval_required` → 사용자 승인 → 실행 순서를 따른다. 이 불변식을 우회하는 코드를 작성하지 않는다.
4. **모든 관리 쓰기 액션은 감사 로그(audit_logs)를 남긴다.** 누가/무엇을/언제/성공여부.
5. **시크릿은 환경변수로만.** `.env.local`은 커밋 금지. 로그에 토큰·시크릿·비밀번호를 출력하지 않는다.
6. **DB 접근은 Drizzle ORM으로만.** 스키마는 `src/db/schema.ts` 단일 파일. raw SQL은 마이그레이션에서만.

## 코드 컨벤션

- Server Component 기본, 상호작용 필요할 때만 `"use client"`
- 데이터 변경은 Server Action 또는 Route Handler. 클라이언트에서 직접 fetch로 Graph를 부르지 않는다
- 날짜/시간은 서버에서 UTC 저장, 표시할 때 KST 변환
- 비즈니스 로직(낭비 금액 계산, 52시간 집계, 승인 상태머신)은 UI와 분리된 순수 함수로 작성해 `src/lib/`에 두고 단위 테스트를 붙인다
- 주석·문서·커밋 메시지는 한국어, 식별자는 영어

## 스펙 주도 개발

- 스펙이 진실의 원천: [docs/specs/requirements.md](docs/specs/requirements.md), [docs/specs/design.md](docs/specs/design.md), [docs/specs/tasks.md](docs/specs/tasks.md)
- 기능 작업 전 해당 스펙 섹션을 읽고, 스펙과 다르게 구현해야 한다면 스펙을 먼저 수정한다
- **브랜치 전략: trunk-based — main 직커밋.** 1인 리포라 브랜치·PR을 만들지 않는다(리뷰어 대기 시간만 늘고 얻는 게 없다). 커밋은 의미 있는 논리 단위로 쪼갠다
- **리뷰는 PR이 아니라 커밋 직전의 다렌즈 병렬 에이전트 리뷰로 대체한다** — 렌즈(정확성·컨벤션·동시성·권한 등)를 나눠 서브에이전트를 동시에 돌리고, 지적은 반박 검증을 거쳐 고유 결함만 채택한다. **채택 결과(지적 건수 / 반영 건수 / 주요 결함)는 커밋 본문에 남긴다** — 이게 이 리포에서 PR 리뷰 스레드를 대신하는 기록이다

## 컨텍스트 제어

- 컨텍스트 사용량이 **70% 이상**이면 새 작업을 시작하지 말고 세션 교체를 준비한다:
  1. 진행 상황을 압축해 기록 — `docs/specs/tasks.md` 체크 상태 갱신 + 미완 작업은 `docs/handoff.md`에 [현재 작업 / 완료된 것 / 다음 단계 / 미커밋 변경 / 검증 상태]로 정리
  2. 검증이 끝난 변경은 커밋·푸시까지 완료한다 (미커밋 상태로 세션을 넘기지 않는다)
  3. 사용자에게 `/clear` 실행을 요청하고, 새 세션은 `docs/handoff.md`와 tasks.md를 읽고 이어서 작업한다
- handoff에는 대화에서만 알 수 있는 맥락(결정 이유, 실패했던 접근)을 반드시 포함한다 — 코드와 커밋만으로 재구성 불가능한 정보가 우선

## 알려진 제약

- 공유 메일박스 전환은 Graph API 미지원(Exchange Online PowerShell 영역) — 오프보딩에서 제외
- Teams 채팅 메시지 본문 읽기는 protected API(Microsoft 승인 필요) — 사용하지 않는다
- E3/E5 평가판 테넌트는 30일 만료 — 데모 영상/스크린샷을 미리 확보한다 (이 프로젝트의 실테넌트는 Microsoft 365 **E3** 25석 평가판)
