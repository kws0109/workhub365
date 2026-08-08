# 프롬프트 로그

AI 페어 프로그래밍으로 구현한 작업마다 **[근거 스펙 + 실행 프롬프트]**를 기록한다 (N6 투명성).
목적: 대화 히스토리가 없는 새 세션(또는 제3자)이 이 로그만 보고 ① 무엇을 근거로 ② 어떤 지시로 구현됐는지 재현할 수 있게 한다.

형식: 항목당 [날짜 / 작업 / 근거 스펙 / 실행 프롬프트 / 결과 커밋]. 프롬프트는 실제 구현에 사용한 문구를 그대로 보존한다.

---

## 2026-08-09 — M7 사이드바 정비 1차 (섹션·아이콘·배지·M365 런처)

- **근거 스펙**: [requirements.md](specs/requirements.md) R7.1~R7.3, [design.md](specs/design.md) "M7 포털 셸" 절
- **요구 배경**: 업계 표준 그룹웨어 UX 패턴(포털형 사이드바, 미결 배지, 플랫폼 앱 런처)을 반영해 앱을 "업무 시작점"으로 만든다. 단 ① M365 화면 iframe 임베드는 하지 않는다(프레이밍 차단 + 경량 애드온 정체성) ② 실시간 숫자는 신선도가 보장되는 홈 대시보드에만 두고, 레이아웃(사이드바)에는 revalidate로 갱신되는 결재 배지만 둔다.
- **실행 프롬프트**:

  > docs/specs/requirements.md의 M7(R7.1~R7.3)과 docs/specs/design.md의 'M7 포털 셸' 절을 읽고 사이드바를 정비하라.
  >
  > 1. `src/components/sidebar.tsx`: 메뉴를 '내 업무'(대시보드/휴가/기안/근태)와 '관리'(admin 전용: 라이선스/온보딩·오프보딩/AI 어시스턴트/감사 로그) 두 섹션으로 나누고 섹션 소제목을 붙인다. 각 메뉴에 인라인 SVG 아이콘(stroke 1.5, currentColor)을 추가한다. 외부 아이콘 라이브러리는 도입하지 않는다.
  > 2. 기안 메뉴 우측에 미결 건수 배지: `src/app/(app)/layout.tsx`(서버)에서 결재함과 동일 조건(내가 현재 차례 step=currentStep, approver status=pending, 기안 in_progress)의 count를 Drizzle로 조회해 Sidebar prop으로 전달한다. 0이면 숨긴다.
  > 3. 사이드바 하단에 'M365 앱' 바로가기 섹션: Outlook 메일/캘린더, Teams, OneDrive, Planner를 테넌트 무관 딥링크로 새 탭(`rel="noopener noreferrer"`)에서 연다. 외부 이동 아이콘(↗)을 붙이고 내부 메뉴보다 낮은 시각 위계(연한 텍스트)로 표시한다. iframe 임베드는 금지.
  > 4. 기존 컨벤션 유지: zinc 라이트 테마, Server Component 기본, 한국어 주석. lint/test/build 통과 후 실브라우저로 검증한다.

- **결과 커밋**: (구현 후 기입)
