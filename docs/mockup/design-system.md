# 목업 디자인 시스템 — 추출 토큰·컴포넌트 규격

> 이 문서는 2026-08-09 세션에서 빈 파일로 커밋돼 내용이 유실됐고, 목업 원본(`workhub365-mockup.html`)에서 재구성했다.

- **원본**: `docs/mockup/workhub365-mockup.html` (사용자 제공 목업, 화면별 마크업·인라인 스타일 포함)
- **단일 소스**: 추출된 토큰은 `src/app/globals.css`의 `@theme`이 단일 소스다. 이 문서는 목업에서 추출한 근거·픽셀 규격의 기록이며, 값이 어긋나면 globals.css를 따른다
- **방향**: 라이트 단일 테마, **무섀도** — 깊이는 보더+배경 대비로만. 포인트 컬러는 모노크롬(`#18181b`), 상태색은 Tailwind 기본 팔레트 그대로

## 1. 컬러 팔레트

### 뉴트럴 (zinc 계열, 시맨틱 별칭)

| 목업 hex | 용도 (목업 내 사용처) | globals.css 토큰 |
|---|---|---|
| `#fafafa` | 페이지 배경, 행 hover, 채팅 영역 배경, 고정 공지 행 | `--color-canvas` |
| `#ffffff` | 카드·사이드바·입력·버튼(secondary) 배경 | `--color-surface` |
| `#f4f4f5` | 옅은 채움 — 선택 항목 배경, 아바타 배경, 진행바 트랙, 내부 구분선, neutral 배지 | `--color-fill` |
| `#e4e4e7` | 기본 보더 (카드·입력·칩) | `--color-line` |
| `#d4d4d8` | 강한 보더 — secondary 버튼, 스크롤바 썸, 흐린 날짜 | `--color-line-strong` |
| `#18181b` | 기본 텍스트 = 포인트 컬러 (primary 버튼·활성 탭·활성 사이드바 배경) | `--color-ink` |
| `#3f3f46` | 긴 본문(메일 본문), primary 버튼 hover 배경 | `--color-ink-body` |
| `#52525b` | 비활성 메뉴·탭, 아바타 글자, 링크 hover | `--color-ink-sub` |
| `#71717a` | 보조 텍스트 — 라벨, 위젯 제목, 범례 | `--color-ink-secondary` |
| `#a1a1aa` | 캡션·placeholder·시각·메타, 프레즌스 offline | `--color-ink-muted` |

### 상태색 (Tailwind 기본 팔레트 — 커스텀 토큰 없음)

globals.css에 별도 토큰을 정의하지 않고 Tailwind 유틸(emerald/amber/red/blue/orange/indigo)을 그대로 쓴다 (design.md 디자인 시스템 절 방침).

| 톤 | 배경 | 텍스트 | 보더/강조 | 목업 내 사용 예 |
|---|---|---|---|---|
| success (emerald) | `#ecfdf5` | `#059669` (진한 `#047857`) | `#a7f3d0` | 승인 배지, 성공 배지, 팀 일정 블록, 승인 휴가 칩, 진행바 `#10b981` |
| warn (amber) | `#fffbeb` | `#b45309` | `#fcd34d`(대기 점선), `#fde68a`(승인 카드 보더) | 대기 배지, 결재 차례, 승인 카드, 필독 카드 |
| notice (amber 진함) | `#fef3c7` | `#92400e` | — | 공지 배지, 사이드바 결재 배지 |
| danger (red) | `#fef2f2` | `#dc2626` (hover `#b91c1c`) | `#fecaca`(공휴일 칩) | 반려·실패 배지, 낭비 금액, 현재 시각 라인 `#ef4444` |
| info (blue) | `#eff6ff` | `#2563eb` (블록 텍스트 `#1d4ed8`) | `#bfdbfe` | 진행 중 배지, 내 일정 블록, 회의실 예약 블록, 안읽음 점 |
| orange | `#fff7ed` | `#ea580c` | — | "로그인 이력 없음" 상태 배지 |
| indigo | `#eef2ff` | `#4f46e5` | — | 감사 로그 AI 실행자 태그 |
| amber 강조 단색 | — | `#d97706` | — | 내 차례 결재 숫자, 폴더·확성기 아이콘, AI 브랜드 점 |

### M365 브랜드 점 (출처 칩)

| 브랜드 | hex | 토큰 |
|---|---|---|
| Outlook | `#0f6cbd` | `--color-brand-outlook` |
| Teams | `#6264a7` | `--color-brand-teams` |
| OneDrive | `#0364b8` | `--color-brand-onedrive` |
| Graph | `#0078d4` | `--color-brand-graph` |
| Claude(AI) | `#d97706` | `--color-brand-ai` |

### 파일타입 미니 아이콘

| 확장자 | hex | 토큰 |
|---|---|---|
| DOC(X) | `#2b579a` | `--color-file-doc` |
| PPT(X) | `#d24726` | `--color-file-ppt` |
| XLS(X) | `#217346` | `--color-file-xls` |
| PDF | `#b91c1c` | `--color-file-pdf` |

### 프레즌스

| 상태 | hex | 토큰 |
|---|---|---|
| online | `#10b981` | `--color-presence-online` |
| away | `#f59e0b` | `--color-presence-away` |
| busy | `#ef4444` | `--color-presence-busy` |
| offline | `#a1a1aa` | `--color-presence-offline` |

## 2. 타이포그래피

폰트: Geist 400/500/600/700 + 한글 폴백(`-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Segoe UI', sans-serif`). **숫자는 전부 `font-variant-numeric: tabular-nums`**(시각·금액·카운트). 모노(`ui-monospace, Menlo, monospace`)는 기술 식별자 전용 — 액션명 12px, JSON 상세 11px, 도구 칩 11px.

| 용도 | 크기/굵기 | 자간 | 색 |
|---|---|---|---|
| 페이지 제목 h1 | 24px / 700 | -0.02em | ink |
| 페이지 서브 | 14px / 400 | — | `#71717a` |
| 로고 (사이드바) | 18px / 700 | -0.02em | ink |
| 카드 섹션 제목 h2 | 15px / 600 | — | ink |
| 상세 제목 (결재 문서·메일 제목) | 16~18px / 600 | 18px는 -0.01em | ink |
| 카드 소제목 (범례 등) | 13px / 600 | — | ink |
| 스탯 값 (대) | 30px / 700 | -0.02em | ink (강조 시 상태색) |
| 스탯 값 (중) | 22px / 700 | -0.01em | ink |
| 스탯 값 (소, 밀집 타일) | 20px / 700 | -0.01em | ink |
| 위젯 라벨 | 12px / 500 | — | `#71717a` |
| 본문 (목록 행·폼) | 14px / 400~500 | — | ink |
| 긴 본문 (메일) | 14px / 400, line-height 1.75 | — | `#3f3f46` |
| 밀집 행 (테이블·리스트) | 13px | — | ink |
| 채팅 버블 | 13.5px, line-height 1.55~1.6 | — | 문맥별 |
| 캡션·메타 | 12px | — | `#a1a1aa` |
| 마이크로 (시각·건수·배지) | 11px / 500~600 | — | 문맥별 |
| 초소형 (인라인 태그·달력 칩) | 10~10.5px / 500~600 | — | 문맥별 |

## 3. 간격 · radius · 보더 위계

### radius

| 값 | 대상 | 토큰 |
|---|---|---|
| 12px | 카드, 승인 카드 | `--radius-card` |
| 10px | 결재 마스터 카드, 채팅 버블 |
| 8px | 컨트롤 — 버튼·입력·탭·사이드바 항목·결재선 행·첨부 칩 |
| 6~7px | 리스트 소항목(폴더·트리), 일정/회의실 블록, 파일 아이콘(5~6), 퀵액션(7) |
| 999px | 필 — 배지·칩·세그먼트 알약·날짜 라벨 |
| 원형(50%) | 아바타, 단계 번호, 프레즌스 점 |

### 간격·치수

| 항목 | 값 |
|---|---|
| 사이드바 폭 | 224px (`--spacing-sidebar`) |
| 콘텐츠 패딩 | 32px |
| 페이지 max-width | 920(온보딩·AI) / 1080(홈) / 1140(근태·게시판·조직도·라이선스·감사) / 1240(일정·결재·문서함·회의실) |
| 카드 패딩 | 20px (밀집 타일 16px, 리스트 카드 12px) |
| 그리드 gap | 16px (카드 그리드), 12px (인물 카드·폼) |
| 헤더→콘텐츠 | margin-top 20~24px |
| 섹션 간 | margin-top 16px (제목 있는 대형 섹션 24px) |
| 테이블 행 패딩 | 헤더 8px 16~20px, 행 9~10px 16~20px |
| 카드 내 리스트 행 | padding 8px 0, 구분선 `#f4f4f5` |

### 보더·배경 위계 (무섀도)

1. 페이지 `#fafafa` → 카드 `#ffffff` + 보더 `#e4e4e7` (radius 12)
2. 카드 내부 구분선·소프트 보더는 한 단계 옅은 `#f4f4f5`
3. hover: 행은 배경 `#fafafa`, 인터랙티브 카드·칩은 보더만 `#a1a1aa`로 진하게
4. 선택 상태: 배경 `#f4f4f5`(목록) 또는 보더 `#18181b`(마스터 카드)
5. 그림자 사용 금지 — 어디에도 box-shadow 없음

스크롤바(WebKit): 폭 10px, 썸 `#d4d4d8` radius 5 + `#fafafa` 2px 보더, 트랙 투명.

## 4. 컴포넌트 규격

구현체: `src/components/ui.tsx` (Card, StatTile, Badge, SourceChip, Avatar, PageHeader, FileTypeIcon, ProgressBar). 아래는 목업에서 추출한 원 규격.

### 카드 (Card)

- `bg #ffffff · border 1px #e4e4e7 · radius 12 · padding 20` (밀집 16)
- 클릭 가능 카드는 hover 시 `border-color #a1a1aa`
- 사용 예: 홈 위젯 전부, 라이선스 표 컨테이너, 온보딩 폼

### 스탯 타일 (StatTile)

- 라벨 `12/500 #71717a` → 값 `30/700 -0.02em tabular` → 캡션 `12 #a1a1aa` (값 위 margin 4~6, 캡션 위 8~10)
- 변형: 중형 값 `22/700 -0.01em`(근태 3타일), 소형 값 `20/700 -0.01em` + padding 16(라이선스 4타일)
- 값 강조색: 결재 대기 `#d97706`, 낭비 금액 `#dc2626`
- 사용 예: 홈 "내 차례 결재 2건", 라이선스 "월 낭비 추정 ₩1,805,500"

### 배지 (Badge, 톤별)

- 필 999 · padding 2px 8px · `12/500` (밀집 테이블 11px, 공지 `11/600`, 인라인 태그 `1px 6px 10px`)
- 톤: success `#ecfdf5/#059669` · warn `#fffbeb/#b45309` · notice `#fef3c7/#92400e` · danger `#fef2f2/#dc2626` · info `#eff6ff/#2563eb` · neutral `#f4f4f5/#71717a` · orange `#fff7ed/#ea580c` · indigo `#eef2ff/#4f46e5` · inverse `#18181b/#ffffff`
- 사용 예: 결재 상태(대기/진행 중/승인/반려), 라이선스 사용자 상태 4종, "관리자 전용", 감사 실행자 태그

### 출처 칩 (SourceChip, R8.9)

- `inline-flex · gap 5~6 · border 1px #e4e4e7 · bg #ffffff · 필 999 · padding 2px 8px · 11/500 #71717a`
- 브랜드 점: `6×6px radius 3` (브랜드 hex)
- 사용 예: 화면 헤더 "Outlook 연동 · Graph API", 홈 위젯 우상단 "Outlook"/"OneDrive", 어시스턴트 "Claude · MCP 도구 10종". 목업은 데모 prop(`chips`)으로 온오프 토글

### 아바타 (+프레즌스 점)

- 크기: 40(조직도) / 36(메일·대화 목록) / 32(채팅 헤더) / 30(채팅 버블·AI)
- `bg #f4f4f5 · color #52525b · 600` — 글자 크기 15/14/13/12 (크기 순), 이니셜 1자
- 프레즌스 점: `10~11px 원형 · border 2px #ffffff · 우하단 -1px` 겹침, 프레즌스 hex
- AI 아바타 변형: `bg #18181b · color #ffffff · "AI" 11/700`
- 사용 예: 조직도 인물 카드, 메일 본문 발신자, 메신저 대화 목록

### 테이블 행

- 헤더 행: `11/500 #a1a1aa · padding 8px 16~20px`
- 데이터 행: `13px · padding 9~10px 16~20px · border-top 1px #f4f4f5 · hover #fafafa`
- 컬럼은 flex 고정폭 (예: 감사 로그 — 시각 130 / 실행자 150 / 액션 170 / 상세 flex / 결과 40 center)
- 우측 정렬: 숫자·금액 컬럼(tabular). 2줄 셀: 주 텍스트 `13/500` + 보조 `11 #a1a1aa`
- 사용 예: 라이선스 SKU 표·사용자별 현황, 감사 로그, 문서함 파일 목록

### 버튼

- **primary**: `bg #18181b · color #ffffff · radius 8 · padding 8px 16px · 13~14/500 · hover bg #3f3f46` (border 없음)
- **secondary**: `border 1px #d4d4d8 · bg #ffffff · color #18181b · radius 8 · padding 8px 14px · 13/500 · hover bg #fafafa`
- 시맨틱 변형: 승인 `bg #059669 hover #047857`, 반려/위험 `bg #dc2626 hover #b91c1c`
- 소형: padding 7px 12~14px 12px. disabled: opacity 0.4
- 사용 예: "메일 쓰기"(primary), "Outlook에서 열기"(secondary+외부 아이콘), 결재 "승인/반려"

### 입력

- `border 1px #e4e4e7 · radius 8 · padding 8px 12px · 13~14px · bg #ffffff · outline none · placeholder #a1a1aa`
- 검색 인풋 폭: 200(감사)/220(문서함)/260(조직도). 채팅 입력 `padding 9px 14px · 13.5px`
- 폼 라벨: `12/500 #71717a`, 라벨→입력 margin 4~6px
- 사용 예: 조직도 검색, 결재 의견, 온보딩 폼, 어시스턴트 입력

### 탭 / 세그먼트

- 항목: `radius 8 · padding 6px 12px · 13/500` — 활성 `bg #18181b color #ffffff`, 비활성 `#52525b hover bg #f4f4f5`, gap 4
- 소형 변형: `padding 5px 12px`(라이선스 30/60/90일)
- 선택 칩(필터·온보딩 라이선스/그룹): 필 999 `padding 5px 12px 12/500` — 선택 `bg #18181b #ffffff`, 미선택 `border #e4e4e7 #52525b hover border #a1a1aa`
- 사용 예: 결재함/내 기안/참조, 게시판 카테고리, 감사 전체/사용자/AI

### 사이드바 항목

- 항목: `radius 8 · padding 8px 12px · 14/500 · gap 10` — 활성 `bg #18181b color #ffffff`, 비활성 `#52525b hover bg #f4f4f5 + #18181b`
- 아이콘: 인라인 SVG `16×16 · stroke 1.5 · currentColor`
- 카운트 배지: 필 `padding 2px 6px · 11/600` — 일반 `bg #f4f4f5 #52525b`, 주의 `bg #fef3c7 #92400e`(결재), `margin-left auto`
- 섹션 라벨: `12/500 #a1a1aa · padding 0 12px 4px`, 섹션 간 gap 20
- M365 링크(위계 낮춤): `13px #a1a1aa · padding 6px 12px` + 외부 아이콘 `12px #d4d4d8` 우측
- 로고 영역 `padding 16px 20px` + 하단 보더 / 사용자 푸터 `padding 16` (이름 14/500 · 부서 12 `#71717a` · 로그아웃 12 `#a1a1aa`)

### 페이지 헤더

- h1 `24/700 -0.02em` + 옆에 출처 칩(gap 10), 우측 액션 버튼 묶음(gap 8), `flex-wrap`
- 서브 텍스트 `14 #71717a margin-top 4` (홈·온보딩·감사)
- 헤더 아래 콘텐츠 `margin-top 20`

### 추가 패턴

- **진행바**: 트랙 `6px radius 3 bg #f4f4f5`, 바 `#10b981`(근무시간). 저장 공간 게이지는 `5px`, 바 `#52525b`
- **첨부/파일 칩**: `border 1px #e4e4e7 radius 8 padding 8px 12px` — 아이콘 24 radius 6 + 이름 `13/500` + 메타 `11 #a1a1aa`. 소형: radius 6, padding 4px 10px, 아이콘 16 radius 4
- **승인 카드**(결재·AI 공용): `border 1px #fde68a · bg #fffbeb · radius 12 · padding 16~20`, 제목 `13~14/600 #92400e`, 내부 상세 박스 `border #f4f4f5 bg #ffffff radius 8 padding 10px 12px 12px/1.7`
- **결재선 행**: `radius 8 padding 8px 12px 14px` — 차수 라벨 `32px 12/600 #a1a1aa` — 현재 차례 `border #fcd34d bg #fffbeb`, 그 외 `border #f4f4f5`
- **채팅 버블**: max-width 60~76%, radius 10, `padding 8~10px 12~14px 13.5px` — 내 것 `bg #18181b #ffffff`, 상대 `bg #ffffff border #e4e4e7`, 멘션 강조 `bg #fffbeb border #fcd34d`. 메타 라인 `11 #a1a1aa`
- **도구 실행 칩**(어시스턴트): 필 999 `border #e4e4e7 bg #ffffff padding 3px 10px 11px mono` + `✓ #059669`
