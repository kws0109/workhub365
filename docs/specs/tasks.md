# WorkHub365 작업 목록

Phase 단위로 브랜치 → PR. 완료 시 체크.

## Phase 0 — 셋업
- [x] Next.js(TS, App Router, Tailwind) 스캐폴드
- [x] CLAUDE.md / 스펙 문서(requirements, design, tasks)
- [ ] GitHub 공개 리포 + Wiki 활성화
- [ ] .env.example / 테넌트·앱 등록 가이드(docs/setup-guide.md)

## Phase 1 — 기반
- [ ] Auth.js + Entra ID SSO 로그인/로그아웃, 세션에 역할 포함
- [ ] ADMIN_EMAILS 부트스트랩 + 역할 가드(미들웨어/헬퍼)
- [ ] app-only Graph 클라이언트(client credentials, 429 재시도 래퍼)
- [ ] Drizzle + Neon 연결, 스키마 정의 + 마이그레이션
- [ ] 공통 레이아웃(사이드바 내비, 역할별 메뉴)

## Phase 2 — M1 라이선스 대시보드
- [ ] subscribedSkus/users 수집 + 조인
- [ ] calcLicenseWaste 순수 함수 + 단위 테스트
- [ ] 대시보드 UI(SKU 현황, 비활성×라이선스 매트릭스, 낭비 금액, 추천)
- [ ] sku_prices 단가표 편집 화면

## Phase 3 — M2 온보딩/오프보딩
- [ ] 파이프라인 프레임(단계 정의/실행/재시도/감사 로그)
- [ ] 온보딩 마법사(계정 생성→라이선스→그룹→임시 비밀번호 표시)
- [ ] 오프보딩 마법사(차단→세션 철회→회수→그룹 제거) + 확인 다이얼로그
- [ ] 감사 로그 조회 화면

## Phase 4 — M3 휴가 / M4 근태
- [ ] 휴가 신청/취소 + 결재선 승인/반려 + 잔여 연차 차감(transitionLeave + 테스트)
- [ ] 팀 캘린더 월 뷰
- [ ] 출퇴근 체크인/아웃 + 주간 집계(aggregateWeeklyMinutes + 테스트) + 52시간 경고
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
