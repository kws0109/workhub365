# @workhub365/mcp-server

WorkHub365 AI 어시스턴트 도구의 단일 소스. 두 가지 방식으로 소비된다.

1. **in-process** — Next.js `/api/assistant` tool use 루프가 `TOOLS`/`executeTool`을 직접 import
2. **stdio MCP 서버** — Claude Desktop 등 외부 MCP 클라이언트에서 사용

```bash
npm run mcp:stdio
```

## 승인 게이트 불변식

- 변경형 도구(`requiresApproval: true`)는 `executeTool`에 `approvalGranted`가 명시되지 않으면 **절대 실행되지 않고** `approval_required`를 반환한다.
- `approvalGranted`를 전달하는 유일한 코드는 웹 승인 카드의 서버 액션이며, DB에서 `pending → executing` 조건부 UPDATE(CAS) 클레임에 성공한 경우에만 실행한다 (실행-정확히-1회).
- stdio 모드는 `approvalGranted`를 전달하지 않으므로 외부 MCP 클라이언트는 조회형 도구만 실제로 실행할 수 있다.

## 구조

| 파일 | 역할 |
|---|---|
| `src/types.ts` | `ToolContext`(의존성 주입 인터페이스)와 결과 타입 — 앱 코드를 import하지 않음 |
| `src/tools.ts` | 도구 10종 정의(zod 스키마·설명·`requiresApproval`) + `executeTool` 게이트 |
| `src/server.ts` | MCP 저수준 Server + stdio transport |
| `src/stdio.ts` | 독립 실행 엔트리 (`.env.local` 로드 후 앱의 ops 구현 주입) |

Graph/DB 실제 구현은 `src/lib/assistant/ops.ts`(앱)가 제공한다 — 도구는 `ToolContext` 인터페이스에만 의존하므로 테스트에서는 `vi.fn()` 목으로 대체한다.
