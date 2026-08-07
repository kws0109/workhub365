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

## Phase 5 — M5 AI 어시스턴트
- [ ] packages/mcp-server: 도구 정의(조회형/변경형) + stdio 실행
- [ ] /api/assistant tool use 루프(스트리밍)
- [ ] 승인 카드 UI + approval_requests 흐름
- [ ] 승인 게이트 시나리오 테스트

## Phase 6 — 마무리
- [ ] GitHub Actions CI(lint + test + build)
- [ ] README(아키텍처 다이어그램, 의사결정, 한계, 데모)
- [ ] Wiki: Home / Architecture / Development-Log / Setup-Guide / Roadmap
- [ ] Vercel 프로덕션 배포 + 환경변수
- [ ] 데모 시나리오 대본 + 영상
