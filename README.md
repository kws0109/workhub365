# WorkHub365

**M365 위에 얹히는 경량 그룹웨어 + 관리 자동화 (오픈소스)**

Microsoft 365를 쓰는 조직을 위한 올인원 도구입니다. 직원은 M365 계정으로 로그인해 휴가·근태를 관리하고, IT 관리자는 온보딩/오프보딩·라이선스를 자동화하며, AI 어시스턴트가 자연어로 이 액션들을 대행합니다 — 별도 인프라 없이, 조직의 M365 인증과 데이터를 그대로 활용합니다.

> 이 프로젝트는 AI 코딩 에이전트(Claude Code) 주도의 spec-driven development로 개발되며, **개발 과정 전체(스펙, 커밋, 의사결정, 실패와 개선)를 이 리포와 [Wiki](../../wiki)에 투명하게 기록**하는 것 자체가 목표의 일부입니다.

## 왜 만들었나

M365 네이티브 관리 센터는 다음이 약합니다:

- **라이선스 낭비 가시성** — 미사용/과다 할당 라이선스와 낭비 금액을 한눈에 볼 수 없음
- **오프보딩 자동화** — 차단→세션 철회→라이선스 회수→그룹 제거를 수작업으로
- **그룹웨어 기능** — 휴가/근태/승인 워크플로우가 아예 없음

국내 시장에는 M365 전용 관리도구가 사실상 공백입니다(CSP 리셀러와 범용 SaaS 자산관리 도구만 존재).

## 기능

| 모듈 | 설명 |
|---|---|
| 라이선스 대시보드 | SKU 현황, 비활성 사용자×라이선스 매트릭스, 원화 낭비 금액, 다운그레이드 추천 |
| 온보딩/오프보딩 | 계정 생성→라이선스→그룹 배정 / 차단→세션 철회→회수→제거, 단계별 재시도 + 감사 로그 |
| 휴가 관리 | 신청→결재선 승인→잔여 연차 차감, 팀 캘린더 |
| 근태 관리 | 출퇴근 체크, 주간 집계, 52시간 경고 |
| AI 어시스턴트 | "김철수 계정 만들고 영업팀 권한 줘" — 자연어로 관리 액션 실행, 위험 액션은 승인 카드(human-in-the-loop) |

## 기술 스택

- **Next.js App Router (TypeScript)** + Tailwind, Vercel 배포
- **Microsoft Graph API** — 사용자 SSO는 Auth.js + Entra ID(delegated), 관리 액션은 app-only(client credentials)의 2층 인증
- **Neon Postgres + Drizzle ORM** — 휴가/근태/승인/감사로그
- **Claude API tool use + MCP 서버** — 어시스턴트 도구를 독립 실행 가능한 MCP 서버 패키지로 분리

## 시작하기

[docs/setup-guide.md](docs/setup-guide.md) — M365 테넌트 준비, Entra ID 앱 등록 2개, 환경변수 설정, 로컬 실행.

## 문서

- 스펙: [requirements](docs/specs/requirements.md) · [design](docs/specs/design.md) · [tasks](docs/specs/tasks.md)
- 개발 과정 기록: [Wiki](../../wiki) (Architecture / Development-Log / Roadmap)

## 알려진 한계

- 공유 메일박스 전환은 Graph API 미지원(Exchange Online PowerShell 영역)이라 오프보딩 파이프라인에서 제외
- `signInActivity`(마지막 로그인)는 Entra ID P1 이상 필요 — 없는 테넌트에서는 "알 수 없음"으로 강등 표시
- Teams 채팅 본문 등 protected API는 사용하지 않음

## 라이선스

MIT
