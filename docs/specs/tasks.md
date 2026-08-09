# WorkHub365 작업 목록

Phase 단위로 브랜치 → PR. 완료 시 체크.

## Phase 0 — 셋업
- [x] Next.js(TS, App Router, Tailwind) 스캐폴드
- [x] CLAUDE.md / 스펙 문서(requirements, design, tasks)
- [x] GitHub 공개 리포 + Wiki 활성화 (Home/Architecture/Development-Log/Setup-Guide/Roadmap)
- [x] .env.example / 테넌트·앱 등록 가이드(docs/setup-guide.md)

## Phase 1 — 기반
- [x] Auth.js + Entra ID SSO 로그인/로그아웃, 세션에 역할 포함 (실테넌트 로그인 검증 완료)
- [x] ADMIN_EMAILS 부트스트랩 + 역할 가드(레이아웃+페이지 헬퍼) — admin 검증 완료, 일반 직원 계정 차단 검증은 Phase 4에서 테스트 계정으로
- [x] app-only Graph 클라이언트(client credentials, 429 재시도 래퍼) — 실호출 검증은 Phase 2에서
- [x] Drizzle + Neon 연결, 스키마 정의 + db:push 반영
- [x] 공통 레이아웃(사이드바 내비, 역할별 메뉴)

## Phase 2 — M1 라이선스 대시보드
- [x] subscribedSkus/users 수집 + 조인 (라이선스 보유자 $filter, 페이지 상한 50, signInActivity 강등 경로)
- [x] calcLicenseWaste 순수 함수 + 단위 테스트 16개 (Suspended SKU 0원, warning 좌석 포함, 초과 할당 클램프 포함)
- [x] 대시보드 UI(SKU 현황, 사용자 상태 매트릭스, 원화 낭비 금액, 절감 추천) — 실테넌트 검증 완료
- [x] SKU 단가 인라인 편집(서버 측 SKU 대조 검증, 이전→이후 감사 로그)

## Phase 3 — M2 온보딩/오프보딩
- [x] 파이프라인 프레임(단계=데이터, NDJSON 스트리밍, 실패 단계부터 재시도, resumeFrom 검증)
- [x] 온보딩 마법사(계정 생성→라이선스→그룹→임시 비밀번호 1회 표시) — 실테넌트 E2E 검증
- [x] 오프보딩 마법사(차단→세션 철회→회수→그룹 제거, 자기 자신 차단, 동적 그룹 건너뜀) — 실테넌트 E2E 검증
- [x] 감사 로그 조회 화면 (회수 skuId·그룹 목록까지 기록)

## Phase 4 — M3 휴가 / M4 근태
- [x] 휴가 신청/취소 + 결재선 승인/반려 + 잔여 연차 차감 — 실테넌트 E2E 검증 (2단계 결재, 잔여 15→8 정확)
- [x] 팀 캘린더 월 뷰 (휴일 표시, 부서 범위 가시성)
- [x] 출퇴근 체크인/아웃 + 주간 집계 + 52시간 게이지·경고 (KST 자정 넘김 퇴근 지원)
- [x] 휴일 기능: 공휴일 자동 수집(Nager.Date) + 전사 휴일 관리(admin) + 주말·휴일 단일 휴가 원천 차단
- [x] 서버 액션 {error} 반환 + ActionForm(useActionState) — 프로덕션에서도 검증 메시지 표시
- [ ] (스트레치) 승인 시 Outlook 캘린더 이벤트 생성

## M6 — 기안(전자결재) (Phase 4 이후 추가)
- [x] 템플릿 4종(경비/데이터 반출/휴직/구매) + 순수 로직(결재선 해석·검증·단계 전이) + 테스트 12개
- [x] 자동 결재선(부서 매니저→관리자) + 편집기(추가/삭제/순서, 본인 제외)
- [x] 순차 결재: 승인→단계 전이/완결, 반려 즉시 종결(사유 필수), 회수 — 실브라우저 E2E 검증
- [x] 내 기안/결재함(내 차례만)/상세 화면, 감사 로그

## M7 — 업무 포털 셸 (M6 이후 추가)
- [x] 사이드바: 섹션 그룹핑(내 업무/관리) + 인라인 SVG 아이콘
- [x] 기안 미결 건수 배지 (레이아웃 서버 조회 → prop, 스냅샷 방침은 design.md M7) — 실브라우저 E2E 검증(배지 표시·승인 후 소멸)
- [x] M365 앱 바로가기 섹션 (딥링크 새 탭, 낮은 시각 위계, 임베드 금지)
- [x] 홈 대시보드 위젯 그리드 (자체 데이터) — 근무 카드(출퇴근 액션)·내 차례 결재·잔여 연차·주간 근무 게이지·내 기안 최근 + admin: 낭비 KPI·최근 감사 로그 (Suspense 스트리밍, 실브라우저 E2E 검증)
- [x] 홈 M365 위젯 (안읽은 메일/오늘 일정) — 위임 스코프 확장 + 서버 전용 토큰 헬퍼(쿠키 JWT 복호화·리프레시) + 재로그인 동의 완료. 메일 위젯 실값 E2E 검증, 일정은 쿼리 정상(200)·목록 표시는 실이벤트 미검증(app-only Calendars 권한 미부여로 테스트 이벤트 생성 불가)
- [ ] (후속) 모바일: 상단 바 + 햄버거 드로어

## Phase 5 — M5 AI 어시스턴트
- [x] packages/mcp-server: 도구 정의(조회형 5 + 변경형 5) + stdio 실행 — JSON-RPC(initialize→tools/list) 실검증, 변경형은 stdio에서 승인 안내만 반환
- [x] /api/assistant tool use 루프(스트리밍) — NDJSON, 원본 블록 왕복, refusal/max_tokens 분기
- [x] 승인 카드 UI + approval_requests 흐름 — executing CAS 클레임(실행-정확히-1회), 멱등 키, 만료 15분. 실브라우저 E2E(승인→Graph 실행, 거부)
- [x] 승인 게이트 시나리오 테스트 — 변경형 전체 approval_required, 조회형 부수효과 전무, R5.3 커버리지 (테스트 31개 추가, 총 96개)

## Phase 6 — 마무리
- [x] GitHub Actions CI(lint + test + build) — 시크릿 불필요(.env 없는 빌드 사전 검증), 첫 실행 전 단계 통과
- [x] README(아키텍처 다이어그램, 의사결정, 한계, 데모) — mermaid 2종(시스템 구성·승인 게이트 시퀀스), 의사결정 표, CI 배지
- [x] Wiki: Home / Architecture / Development-Log / Setup-Guide / Roadmap — Phase 5까지 현행화(Architecture mermaid·결정 6종)
- [ ] Vercel 프로덕션 배포 + 환경변수 — 준비 완료([docs/deploy.md](../deploy.md): 절차·환경변수 표·리디렉션 URI). 계정 로그인·리포 임포트는 사용자 액션
- [ ] 데모 시나리오 대본 + 영상 — 대본 완료([docs/demo-script.md](../demo-script.md), 장면 7개), 영상 녹화 남음
