# 스크린샷 촬영 기록

`public/screenshots/`의 화면 캡처를 다시 찍거나 추가할 때 참고할 기준. **README와 [제품 소개 페이지](../site/index.html)가 같은 파일을 본다** — Pages 워크플로가 빌드 시 `public/screenshots`를 복사하므로 한 곳만 갱신하면 양쪽이 함께 바뀐다.

## 촬영 조건

- 뷰포트 **1440×900**, 스케일 `css`(디바이스 픽셀 배율 미적용), PNG
- 전체 페이지가 아니라 **뷰포트** 캡처 — 소개 페이지 카드가 16:10 비율에 맞춰져 있고, 전체 페이지는 세로로 지나치게 길어진다
- admin 계정으로 로그인하고 **확장 스코프 동의가 끝난 세션**이어야 한다. 아니면 홈의 메일·문서 위젯이 "다시 로그인" 안내 카드로 강등된 채 찍힌다
- 시드 순서: `seed-leave-demo.mjs` → `seed-board-demo.mjs` → 촬영 (시드가 잔여 연차를 초기화한다)

## 현재 촬영본

| 파일 | 경로 | 상태 |
|---|---|---|
| `home.png` | `/` | 4열 위젯 전부 실데이터 — 안읽은 메일 2통, 최근 문서, 공지 3건, 낭비 KPI |
| `licenses.png` | `/licenses` | app-only Graph 실집계 |
| `assistant-approval.png` | `/assistant` | 라이선스 회수 요청 → 승인 카드 대기 상태. 촬영 후 **거부로 정리**했다 |
| `leave.png` | `/leave` | 팀 캘린더 월 뷰 — 휴가 칩·공휴일·대기 점선 |
| `org.png` | `/org?dept=개발` | 부서 트리 + 인물 카드 |
| `hr-correct.png` | `/attendance/manage?user=…&week=…` | 주간 7일 전개 + 정정 폼 |
| `audit.png` | `/audit?q=attendance.` | 전후 스냅샷이 보이는 검색 결과 |

## 촬영하지 않은 화면과 이유

- **메일(3패널)** — 받은편지함에 실제 Microsoft 청구서 메일만 있어 본문에 결제 정보가 노출된다. 공개 페이지에 부적절해 제외했다
- **일정(주간 그리드)** — 테넌트 캘린더에 이벤트가 없어 빈 그리드만 나온다. 제품 소개에는 설득력이 없어 휴가 캘린더로 대체했다. 실제 일정이 생기면 `calendar.png`로 추가하고 소개 페이지에 카드를 넣으면 된다
- **회의실 예약** — 리소스 사서함이 없어 안내 카드로 강등된 상태다

## 승인 카드를 다시 찍으려면

`/assistant?prompt=<요청>`으로 진입해 전송하면 승인 카드가 뜬다. **촬영 후 반드시 거부하거나 만료시킬 것** — 승인하면 실제 Graph 액션이 실행된다.

## 다시 찍은 뒤

```bash
git add public/screenshots && git commit -m "docs: 화면 캡처 갱신"
```

푸시하면 Pages가 자동 재배포된다. https://kws0109.github.io/workhub365/#screens 에서 확인.
