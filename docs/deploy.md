# Vercel 프로덕션 배포

로컬 셋업([setup-guide.md](setup-guide.md))이 끝났다는 전제로, Vercel에 배포하는 절차다.

> 현재 프로덕션: **https://workhub365-five.vercel.app** (2026-08-09 배포·검증 완료)
> 주의: `workhub365.vercel.app`(-five 없음)은 **타인의 무관한 프로젝트**가 선점한 도메인이다 — 우리 앱이 아니다.

## 1. 프로젝트 임포트

1. [vercel.com/new](https://vercel.com/new)에서 `kws0109/workhub365` 리포를 Import — 프레임워크(Next.js)는 자동 감지되므로 빌드 설정은 기본값 그대로 둔다
2. 첫 배포는 환경변수가 없어도 빌드는 통과한다(DB 클라이언트 지연 초기화). 로그인·기능은 환경변수 설정 후 동작

## 2. 환경변수 (Project Settings → Environment Variables)

`.env.example`의 전체 키를 Production에 등록한다:

| 키 | 값 | 비고 |
|---|---|---|
| `AUTH_MICROSOFT_ENTRA_ID_ID` | SSO 앱 등록 클라이언트 ID | |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | SSO 앱 시크릿 | |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | `https://login.microsoftonline.com/<테넌트ID>/v2.0` | 미설정 시 로그인 전면 거부(fail-closed) |
| `AUTH_SECRET` | `npx auth secret`으로 새로 생성 | 로컬 값과 달라도 됨(세션 무효화만) |
| `AUTH_URL` | `https://<배포 도메인>` | 커스텀 도메인 쓰면 그 값으로 |
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | app-only 앱 등록 | 관리 액션용 — 브라우저로 절대 안 내려감 |
| `DATABASE_URL` | Neon 연결 문자열(`-pooler` 호스트) | 로컬과 같은 DB를 써도 됨(데모 목적) |
| `ANTHROPIC_API_KEY` | Claude API 키 | AI 어시스턴트 |
| `ASSISTANT_MODEL` | `claude-sonnet-5` | |
| `ADMIN_EMAILS` | admin 부트스트랩 이메일(쉼표 구분) | |

## 3. Entra 앱 등록에 프로덕션 리디렉션 URI 추가

SSO 앱 등록(#1) → 인증 → 리디렉션 URI에 추가:

```
https://<배포 도메인>/api/auth/callback/microsoft-entra-id
```

localhost URI는 그대로 두면 로컬 개발과 병행 가능하다.

## 4. 함수 실행 시간

- `/api/assistant`(tool use 루프) `maxDuration = 180`, `/api/lifecycle` `maxDuration = 120` — Vercel 기본 한도(300초, Fluid Compute) 안이라 추가 설정 불필요

## 5. 배포 후 확인 체크리스트

1. `https://<도메인>/login` → Microsoft SSO 로그인 (admin 계정)
2. 홈 대시보드 위젯 실값 렌더 (M365 위젯은 재로그인 동의 후)
3. 라이선스 대시보드 — Graph 실데이터 조회 확인
4. AI 어시스턴트 — 조회 1건 + 승인 카드 흐름(세션 철회가 무해해서 적합)
5. 감사 로그 화면에 위 액션들이 기록됐는지

## 주의 (실제로 겪은 함정 포함)

- **`AUTH_URL`을 `.env.example` 기본값(`http://localhost:3000`) 그대로 복사하지 말 것** — 로그인 후 리디렉션이 localhost로 돌아가 화면이 멈춘다 (첫 배포에서 실제 발생). 반드시 배포 도메인으로
- **환경변수를 바꾸면 Redeploy해야 반영된다** (Deployments → ⋯ → Redeploy)
- `.vercel.app` 기본 서브도메인은 선점될 수 있다 — 프로젝트명과 무관하게 Settings → Domains에서 실제 할당된 도메인을 확인할 것
- 시크릿을 커밋하지 않는다 — 환경변수는 Vercel 대시보드에서만 관리
- E3 평가판 테넌트는 30일 만료 — 만료 후에는 Graph 조회가 실패하며 화면은 오류 카드로 강등된다
