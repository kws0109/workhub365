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
- ~~(후속) 모바일: 상단 바 + 햄버거 드로어~~ — 폐기 (2026-08-09, 데모 일정 우선. 데스크톱 데모에 모바일 뷰 불필요)

## Phase 5 — M5 AI 어시스턴트
- [x] packages/mcp-server: 도구 정의(조회형 5 + 변경형 5) + stdio 실행 — JSON-RPC(initialize→tools/list) 실검증, 변경형은 stdio에서 승인 안내만 반환
- [x] /api/assistant tool use 루프(스트리밍) — NDJSON, 원본 블록 왕복, refusal/max_tokens 분기
- [x] 승인 카드 UI + approval_requests 흐름 — executing CAS 클레임(실행-정확히-1회), 멱등 키, 만료 15분. 실브라우저 E2E(승인→Graph 실행, 거부)
- [x] 승인 게이트 시나리오 테스트 — 변경형 전체 approval_required, 조회형 부수효과 전무, R5.3 커버리지 (테스트 31개 추가, 총 96개)

## Phase 7 — 디자인 개편 + M8 협업 (2026-08-09 추가, 목업 기준)

- [x] 디자인 코어: globals.css @theme 토큰(목업 추출값) + 공용 컴포넌트(Card/StatTile/Badge/SourceChip/Avatar) + 셸·사이드바 개편(협업 섹션, 메일 배지, 사용자 푸터)
- [x] 기존 화면 디자인 정렬: 홈(4열 위젯) / 라이선스(+AI 일괄 회수 딥링크, 비활성 30/60/90 세그먼트) / 근태·휴가(세그먼트 3탭) / 결재(마스터-디테일 ?sel=, [id]는 리다이렉트) / 온보딩(칩 UI + audit_logs 파생 최근 실행 이력) / 감사(필터 탭+검색) / 어시스턴트(만료 카운트+프리필+추천 칩) — 전부 실브라우저 검증
- [x] 신규: 조직도(부서 트리+인물 카드+휴가 배지+프레즌스) — 프레즌스 실호출 검증(데모 계정 전원 offline), 휴가 배지는 오늘 승인 건 부재로 조인 경로만 코드 검증
- [x] 신규: 일정(주간 타임 그리드, calendarView) — 순수 로직 테스트 16개. 실이벤트 블록은 테넌트 일정 부재로 미확인(빈 그리드·주 이동 검증)
- [x] 신규: 메일(3패널 읽기, Mail.Read) — 본문은 text Prefer 평문(XSS 차단), 실메일 탐색 검증
- [x] 신규: 게시판(posts/post_reads 테이블, 탭·고정·필독·조회수·인기) — 시드 12건, 조회수·필독 확인 실검증
- [x] 신규: 문서함(OneDrive 읽기, Files.Read) + 홈 최근 문서·최근 공지 위젯 — 쿼터 실값, 빈 드라이브 빈 상태
- [x] 신규: 회의실 예약(places+getSchedule+이벤트 생성) — 구현 완료. 앱 등록에 Place.Read.All 미부여라 권한 안내 카드로 강등 중(실예약 검증은 권한 부여+회의실 생성 후)
- [x] M5 전직원 개방: 도구 minRole 매트릭스 + employee 조회 도구 3종(actor 주입) + 게이트 테스트 확장(총 169개) — employee 계정 실브라우저 검증은 남음(게이트는 테스트 커버)
- [x] 위임 스코프 확장(Calendars.ReadWrite·Files.Read·Presence.Read.All) + 재로그인 동의 검증 — 구세션 강등→재로그인 동의→회복 실확인
- [x] 메신저·Teams 멘션 위젯 제외 (protected API — R8.7 결정) — 홈 4열은 최근 문서·공지로 대체

## Phase 6 — 마무리
- [x] GitHub Actions CI(lint + test + build) — 시크릿 불필요(.env 없는 빌드 사전 검증), 첫 실행 전 단계 통과
- [x] README(아키텍처 다이어그램, 의사결정, 한계, 데모) — mermaid 2종(시스템 구성·승인 게이트 시퀀스), 의사결정 표, CI 배지
- [x] Wiki: Home / Architecture / Development-Log / Setup-Guide / Roadmap — Phase 5까지 현행화(Architecture mermaid·결정 6종)
- [x] Vercel 프로덕션 배포 + 환경변수 — https://workhub365-five.vercel.app 배포·실검증 완료(SSO 로그인, 홈 위젯 실값·위임 메일 위젯, 라이선스 Graph 실데이터, 어시스턴트 승인→실행, 감사 로그). AUTH_URL localhost 함정은 deploy.md에 기록
- [ ] 데모 시나리오 대본 + 영상 — 대본 완료([docs/demo-script.md](../demo-script.md), 장면 7개), 영상 녹화 남음
