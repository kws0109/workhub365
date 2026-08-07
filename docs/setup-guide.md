# 셋업 가이드

WorkHub365를 실제 M365 테넌트에 연결해 실행하기까지의 전체 과정입니다.

## 1. M365 테넌트 준비 (E5 30일 평가판)

이미 관리자 권한이 있는 테넌트가 있다면 이 단계는 건너뜁니다.

1. 시크릿 창에서 [Microsoft 365 E5 평가판](https://www.microsoft.com/ko-kr/microsoft-365/enterprise/microsoft365-plans-and-pricing) 접속 → E5 "무료 평가판" 선택
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
5. API 권한은 기본 `User.Read`(delegated)면 충분

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
3. **"<테넌트>에 대한 관리자 동의 허용"** 버튼 클릭 (전역 관리자 필요)
4. 클라이언트 암호 생성 → 값 복사

→ `.env.local`의 `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET`

## 3. 나머지 환경 준비

- **Neon Postgres**: [neon.tech](https://neon.tech) 무료 프로젝트 생성 → 연결 문자열을 `DATABASE_URL`에 (또는 Vercel Marketplace에서 Neon 연동)
- **Anthropic API 키**: [console.anthropic.com](https://console.anthropic.com) → API Keys → `ANTHROPIC_API_KEY`
- **AUTH_SECRET**: `npx auth secret` 실행으로 생성
- **ADMIN_EMAILS**: 본인 관리자 계정 이메일 (쉼표 구분)

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
