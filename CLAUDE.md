# WorkHub365

M365 위에 얹히는 경량 그룹웨어 + 관리 자동화. Next.js App Router(TS) + Microsoft Graph API + Claude AI 어시스턴트.

## 명령어

- `npm run dev` — 개발 서버 (Turbopack)
- `npm run build` — 프로덕션 빌드
- `npm run lint` — ESLint
- `npm test` — Vitest 단위 테스트 (Phase 6에서 추가)

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
- 모듈 단위 브랜치 → PR. 커밋은 의미 있는 단위로 쪼갠다

## 알려진 제약

- 공유 메일박스 전환은 Graph API 미지원(Exchange Online PowerShell 영역) — 오프보딩에서 제외
- Teams 채팅 메시지 본문 읽기는 protected API(Microsoft 승인 필요) — 사용하지 않는다
- E5 평가판 테넌트는 30일 만료 — 데모 영상/스크린샷을 미리 확보한다
