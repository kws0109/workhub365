# 스크린샷 촬영 가이드

README에 넣을 화면 캡처 목록. **E3 평가판 만료 전에** 데모 영상 녹화와 같은 세션에서 한 번에 처리하는 것을 권한다.

## 왜 필요한가

이 리포는 UI 그룹웨어인데 외부인이 화면을 볼 통로가 없다. 라이브 URL은 Entra SSO 전용이라 테넌트 구성원이 아니면 로그인 화면에서 끝나고, README의 이미지는 CI 배지 하나뿐이다. 코드 품질과 무관하게 **리뷰어가 코드를 열기 전에 판정을 끝내는** 구간에서 보여줄 것이 없다.

## 촬영 전 준비

- 브라우저 창 **1440×900**, 줌 100%, 시크릿 창(개인 북마크·확장 프로그램 노출 방지)
- 로그인: admin 계정 (확장 스코프 동의 완료 상태여야 메일·일정·문서함이 실데이터로 뜬다)
- 시드 순서: `seed-leave-demo.mjs` → `seed-board-demo.mjs` → 그다음 촬영 (시드가 잔여 연차를 리셋한다)
- 브라우저 탭 아이콘이 자체 아이콘(검정 바탕 W)인지 확인 — Next.js 기본 로고면 캐시를 비우고 새로고침

## 촬영 목록

저장 위치는 전부 `public/screenshots/`. 파일명을 **정확히** 맞춰야 아래 README 블록이 그대로 동작한다.

| # | 파일명 | URL | 화면 상태 |
|---|---|---|---|
| 1 | `home.png` | `/` | 홈 대시보드 전체. 근무 카드 + 3열 타일 + 4열 위젯(메일·일정·최근 문서·최근 공지) + 관리자 KPI가 한 화면에 들어오게 |
| 2 | `licenses.png` | `/licenses` | 상단부터 절감 추천 카드까지. 낭비 금액(빨강)과 "AI 어시스턴트로 일괄 회수" 버튼이 보이게 |
| 3 | `assistant-approval.png` | `/assistant` | **가장 중요.** "비활성 계정 라이선스 회수해줘" 실행 → 승인 카드가 뜬 상태. 도구 실행 칩 + 승인 카드(대상 이름·만료 카운트·승인/거부 버튼)가 함께 보이게 |
| 4 | `org.png` | `/org` | 조직도. 부서 트리 + 인물 카드 그리드. 오늘 승인 휴가자가 있으면 "휴가" 배지가 보이는 부서를 고를 것 |
| 5 | `calendar.png` | `/calendar` | 주간 타임 그리드. 실제 일정 블록이 있는 주로 이동해서 촬영(빈 그리드는 설득력이 없다) |
| 6 | `hr-correct.png` | `/attendance/manage` | 인사 정정. 직원 선택 후 근태 표가 보이는 상태. "근무 중" 배지 행(출근 입력이 비활성)이 포함되게 |
| 7 | `audit.png` | `/audit` | 감사 로그. `attendance.` 또는 `leave.`로 검색해 before/after 스냅샷이 보이는 상태 |

선택: 승인 게이트를 **6~10초 GIF**로 (`assistant-approval.gif`) — "요청 → 승인 카드 → 승인하고 실행 → 감사 로그" 흐름. 정지 화면보다 설득력이 크다.

## 촬영 후: README에 붙여넣기

`README.md`의 `## 데모` 절 **바로 위**에 아래를 그대로 삽입한다.

```markdown
## 화면

| 홈 대시보드 | 라이선스 낭비 |
|---|---|
| ![홈 대시보드](public/screenshots/home.png) | ![라이선스 낭비 대시보드](public/screenshots/licenses.png) |

**AI 어시스턴트 승인 게이트** — 되돌리기 어려운 액션은 승인 카드를 거쳐야만 실행된다

![AI 어시스턴트 승인 카드](public/screenshots/assistant-approval.png)

| 조직도 (프레즌스·휴가 배지) | 주간 일정 |
|---|---|
| ![조직도](public/screenshots/org.png) | ![주간 일정 그리드](public/screenshots/calendar.png) |

| 인사 정정 (사유 필수·감사) | 감사 로그 (전후 스냅샷) |
|---|---|
| ![인사 정정 화면](public/screenshots/hr-correct.png) | ![감사 로그](public/screenshots/audit.png) |
```

그리고 `## 데모` 절의 라이브 링크 줄 끝에 다음 문장을 덧붙인다:

> 외부 계정은 로그인할 수 없으니 위 화면 캡처로 확인하세요.

## 커밋

```bash
git add public/screenshots README.md && git commit -m "docs: README에 화면 캡처 추가"
```

PNG는 화면당 200~500KB 수준이면 충분하다. 1MB를 넘으면 화질을 낮춰 다시 저장할 것.
