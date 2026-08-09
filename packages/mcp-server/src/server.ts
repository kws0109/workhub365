import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, executeTool, toolInputJsonSchema } from "./tools";
import type { ToolContext } from "./types";

// MCP stdio 서버. 도구 스키마는 zod 버전 결합을 피하려고 저수준 Server API에
// JSON Schema를 직접 전달한다.
//
// 승인 게이트: stdio 모드는 approvalGranted를 절대 전달하지 않으므로 변경형
// 도구는 항상 approval_required 안내만 반환한다 — 외부 MCP 클라이언트가
// 승인 게이트를 우회할 수 없다 (CLAUDE.md 불변식 3).
// 본인 조회 도구(requiresActor)도 같은 패턴: 이 서버에는 로그인 사용자
// 컨텍스트(actor)가 없으므로 실행하지 않고 웹 어시스턴트 사용 안내만 반환한다.
export async function runStdioServer(ctx: ToolContext) {
  const server = new Server(
    { name: "workhub365-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.requiresApproval
        ? `${t.description} [변경형 — 이 서버에서는 실행되지 않고 WorkHub365 웹 승인 절차 안내만 반환한다]`
        : t.requiresActor
          ? `${t.description} [본인 조회 — 이 서버에는 로그인 사용자 컨텍스트가 없어 WorkHub365 웹 어시스턴트 사용 안내만 반환한다]`
          : t.description,
      inputSchema: toolInputJsonSchema(t),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const out = await executeTool(req.params.name, req.params.arguments ?? {}, ctx);
    if (out.kind === "ok") {
      return {
        content: [{ type: "text", text: JSON.stringify(out.result, null, 2) }],
      };
    }
    if (out.kind === "approval_required") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "approval_required",
              summary: out.summary,
              message:
                "변경형 작업은 WorkHub365 웹 AI 어시스턴트에서 요청해 관리자 승인 카드를 통과해야 실행됩니다. 이 MCP 서버에서는 실행할 수 없습니다.",
            }),
          },
        ],
      };
    }
    if (out.kind === "actor_required") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "actor_required",
              toolName: out.toolName,
              message:
                "본인 정보 조회 도구는 WorkHub365 웹 AI 어시스턴트에 로그인한 사용자 컨텍스트가 필요합니다. 이 MCP 서버에서는 실행할 수 없습니다.",
            }),
          },
        ],
      };
    }
    return {
      content: [{ type: "text", text: out.message }],
      isError: true,
    };
  });

  await server.connect(new StdioServerTransport());
  console.error("[workhub365-mcp] stdio 서버 시작 — 도구 %d개", TOOLS.length);
}
