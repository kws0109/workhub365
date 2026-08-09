# 셋업 가이드

WorkHub365를 실제 M365 테넌트에 연결해 실행하기까지의 전체 과정입니다.

## 1. M365 테넌트 준비 (E5 또는 E3 30일 평가판)

이미 관리자 권한이 있는 테넌트가 있다면 이 단계는 건너뜁니다.

**플랜 선택**: **Microsoft 365 E5** 또는 **Microsoft 365 E3** 모두 가능합니다. 이 프로젝트가 유일하게 요구하는 프리미엄 기능은 `signInActivity`(마지막 로그인 조회, Entra ID P1 필요)인데 둘 다 P1을 포함합니다. 단, 이름이 비슷한 **Office 365 E3는 Entra P1이 없으므로 피할 것** (비활성 사용자 탐지가 "알 수 없음"으로 강등됨).

1. 시크릿 창에서 [Microsoft 365 평가판](https://www.microsoft.com/ko-kr/microsoft-365/enterprise/microsoft365-plans-and-pricing) 접속 → E5(또는 E3) "무료 평가판" 선택
2. **새 이메일로 가입** (기존 M365 계정과 연결되지 않은 주소) → 새 테넌트(`<이름>.onmicrosoft.com`)와 전역 관리자 계정이 생성됨
   - 최근에는 카드 등록을 요구할 수 있음(평가판 기간 내 취소하면 과금 없음)
3. [admin.microsoft.com](https://admin.microsoft.com) 로그인 → 사용자 몇 명을 만들어 데모 데이터 구성 (부서·직급 다양하게 5~10명 권장, E5 라이선스 일부만 할당하면 "미할당 라이선스" 데모가 자연스러움)
4. ⚠️ 평가판은 30일 후 만료 — 데모 영상/스크린샷을 미리 확보할 것

## 2. Entra ID 앱 등록 (2개)

[entra.microsoft.com](https://entra.microsoft.com) → ID → 앱 등록 → 새 등록.

### 앱 등록 #1 — 사용자 SSO (delegated)

1. 이름: `WorkHub365-SSO`, 지원 계정 유형: **이 조직 디렉터리만(단일 테넌트)**
2. 리디렉션 URI: 웹 → `http://localhost:3000/api/auth/callback/microsoft-entra-id`
   (배포 후 `https://<도메인>/api/auth/callback/microsoft-entra-id` 추가)
3. 등록 후: 개요에서 **애플리케이션(클라이언트) ID**, **디렉터리(테넌트) ID** 복사
4. 인증서 및 암호 → 새 클라이언트 암호 → **값** 즉시 복사 (다시 볼 수 없음)
5. API 권한 → Microsoft Graph → **위임된 권한**에 아래를 추가 (앱이 실제로 요청하는 스코프는 `src/auth.ts:46-47`에 하드코딩돼 있다):

   | 스코프 | 용도 |
   |---|---|
   | `User.Read` | 로그인 프로필 |
   | `Mail.Read` | 홈 안읽은 메일 위젯, 메일 화면(B1) |
   | `Calendars.ReadWrite` | 일정 화면(B2) + **회의실 예약(B6) — 유일한 쓰기 위임** |
   | `Files.Read` | 문서함·최근 문서(B5·B7) |
   | `Presence.Read.All` | 조직도 프레즌스(B3) — **관리자 동의 필요** |
   | `offline_access` | 리프레시 토큰(액세스 토큰 ~1시간 만료 후 위젯 유지) |

   (`openid profile email`은 Auth.js가 기본으로 붙인다)

   - 나머지 M365 쓰기(메일 작성·파일 편집)는 전부 Outlook/OneDrive **딥링크로 위임**한다 — 그래서 쓰기 위임 스코프가 `Calendars.ReadWrite` 하나뿐이다
   - `Presence.Read.All`은 사용자 개인 동의로 끝나지 않으므로, 이 화면에서 **"관리자 동의 허용"까지 눌러 둘 것**. 동의가 없으면 조직도 프레즌스만 회색으로 강등된다
   - **주의 — 스코프를 바꾸면 반드시 두 곳을 같이 고친다**: `src/auth.ts:46`(로그인 시 요청)과 `src/lib/graph/delegated.ts:96`(리프레시 시 요청). 한쪽만 고치면 리프레시가 미동의 스코프를 요구해 실패하고, 위임 위젯이 조용히 "재로그인 안내"로 강등된다 (두 파일의 주석에도 서로를 가리키는 경고가 달려 있다)
   - 스코프를 확장하면 **기존 세션은 재로그인 동의 전까지 위젯이 강등된 상태**로 남는다 — 정상 경로다

→ `.env.local`의 `AUTH_MICROSOFT_ENTRA_ID_ID` / `AUTH_MICROSOFT_ENTRA_ID_SECRET`,
`AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/<테넌트ID>/v2.0`

### 앱 등록 #2 — 관리 액션 (application, app-only)

1. 이름: `WorkHub365-Admin`, 단일 테넌트, 리디렉션 URI 불필요
2. API 권한 → 권한 추가 → Microsoft Graph → **애플리케이션 권한**에서 추가:
   - `User.ReadWrite.All` — 계정 생성/차단/세션 철회/라이선스 할당
   - `Group.ReadWrite.All` — 그룹 배정/제거
   - `Organization.Read.All` — subscribedSkus(라이선스 현황)
   - `Directory.Read.All` — 디렉터리 조회
   - `AuditLog.Read.All` — signInActivity(마지막 로그인)
   - `Reports.Read.All` — 사용량 리포트
   - `Place.Read.All` — 회의실(리소스 사서함) 목록 `/places/microsoft.graph.room`
     - 미부여 시 `/rooms` 화면이 **권한 안내 카드로 강등된다 — 오류가 아니라 설계된 강등 경로다.** 회의실 데모를 하지 않는다면 건너뛰어도 나머지 기능은 전부 동작한다
     - 실측 주의: `/places`는 미부여 시 403이 아니라 **메시지 없는 401**을 준다(`src/lib/graph/rooms.ts:29`) — 앱이 이를 권한 안내로 변환한다
3. **"<테넌트>에 대한 관리자 동의 허용"** 버튼 클릭 (전역 관리자 필요)
4. 클라이언트 암호 생성 → 값 복사

→ `.env.local`의 `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET`

## 3. 나머지 환경 준비

- **Neon Postgres**: [neon.tech](https://neon.tech) 무료 프로젝트 생성 → 연결 문자열을 `DATABASE_URL`에 (또는 Vercel Marketplace에서 Neon 연동)
  - ⚠️ 반드시 **풀러(pooled) 연결 문자열**(호스트에 `-pooler` 포함)을 사용하세요 — 서버리스 다중 인스턴스에서 커넥션 고갈을 막습니다
  - 스키마 반영: `npm run db:push` + 수동 마이그레이션 `node --env-file=.env.local scripts/apply-manual-migrations.mjs` (EXCLUDE 제약 등 drizzle-kit이 표현 못 하는 DDL)
- **Anthropic API 키**: [console.anthropic.com](https://console.anthropic.com) → API Keys → `ANTHROPIC_API_KEY`
- **AUTH_SECRET**: `npx auth secret` 실행으로 생성
- **ADMIN_EMAILS**: 본인 관리자 계정 이메일 (쉼표 구분) — 매 로그인마다 평가해 admin으로 승격
- **HR_EMAILS**: 인사 정정 권한(`hr_admin`)을 줄 이메일 (쉼표 구분, 선택). ADMIN_EMAILS와 대칭으로 **승격 전용** — 목록에서 빼도 자동 회수되지 않는다(회수는 DB `users.hr_admin` 직접 수정). `admin`은 이 목록에 없어도 자동 겸임한다(`src/lib/hr.ts:11`)

## 4. 로컬 실행

```bash
cp .env.example .env.local   # 값 채우기
npm install
npm run db:push              # Drizzle 스키마 반영 (Phase 1 이후)
npm run dev                  # http://localhost:3000
```

## 5. 배포 (Vercel)

1. GitHub 리포를 Vercel에 연결 → 환경변수 등록 (`AUTH_URL`은 프로덕션 URL로)
2. 앱 등록 #1에 프로덕션 리디렉션 URI 추가
