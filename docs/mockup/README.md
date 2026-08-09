# 목업 원본

`workhub365-mockup.html`은 이 프로젝트의 디자인·기능 기준으로 채택한 **목업 원본 스냅샷**이다(Phase 7). 브라우저로 열어도 화면이 뜨지 않는다 — `<sc-if>`/`<sc-for>` 커스텀 엘리먼트와 props를 해석하는 런타임 스크립트(`<script src="df16afaf-…">`)가 이 리포에 없기 때문이다. 원본을 그대로 보존하는 것이 목적이라 손대지 않았다.

사람이 읽을 버전은 이쪽이다: 화면별 구현 스펙은 [feature-map.md](feature-map.md), 토큰·컴포넌트 규격은 [design-system.md](design-system.md). 구현의 실제 진실은 `src/app/globals.css`의 `@theme`과 `src/components/ui.tsx`다.

목업에 있는 **메신저 화면과 홈 "Teams 멘션" 위젯은 의도적으로 구현하지 않았다** — Teams 채팅 본문은 protected API(Microsoft 승인 필요)라 접근할 수 없고, 자체 DB 채팅을 만드는 것은 "M365 위에 얹는다"는 정체성에 반한다(R8.7). Teams 딥링크로 대체하고, 홈 4열은 최근 문서·최근 공지로 채웠다.
