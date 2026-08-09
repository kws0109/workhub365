import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { assertSession } from "@/lib/auth-helpers";
import { runAssistantToolUse } from "@/lib/assistant/execute";
import {
  toolInputJsonSchema,
  toolsForRole,
} from "../../../../packages/mcp-server/src/tools";
import type { Role } from "../../../../packages/mcp-server/src/types";

// AI 어시스턴트 tool use 루프 (design.md M5).
// 사용자 메시지 → Claude API(tools) → tool_use → 서버에서 실행 → tool_result → … → 최종 응답
// 응답은 NDJSON 스트림: 텍스트 델타·도구 상태·승인 카드 이벤트를 실시간 전달하고,
// 대화 이력(원본 블록)은 append 이벤트로 클라이언트가 보관해 다음 요청에 되돌려 보낸다.
// (Sonnet 5는 adaptive thinking 기본 — thinking 블록도 그대로 왕복시켜야 한다)
//
// R5.1 개정: 전 직원 개방. 도구 목록은 세션 역할로 필터해 모델에 노출하고(1차),
// 실행 직전 executeTool이 actor 역할로 minRole을 재검증한다(2차 — execute.ts 경유).

export const maxDuration = 180; // Graph 스로틀 대기 + 다회 도구 루프 감안

const MAX_ROUNDS = 6; // 한 요청에서 허용하는 모델 호출 횟수 (도구 루프 폭주 방지)
const MAX_MESSAGES = 80;
const MAX_BODY_CHARS = 400_000;

/** 역할별 시스템 프롬프트 — 공통 규칙 + 역할 컨텍스트(사용 가능한 도구 범위) */
function systemPromptFor(role: Role): string {
  const roleContext =
    role === "admin"
      ? `요청자는 admin(IT 관리자) 역할입니다. Microsoft 365 테넌트 관리(라이선스·사용자·근태)를 돕습니다.

- 사용자 ID가 필요한 도구는 먼저 find_users로 대상을 특정합니다. 동명이인 등 대상이 모호하면 실행 전에 사용자에게 확인합니다.
- 변경 작업(계정 생성·차단, 라이선스 회수, 세션 철회, 그룹 제거)은 도구가 approval_required를 반환하며, 화면의 승인 카드에서 관리자가 직접 승인해야 실행됩니다. 당신은 승인을 대신할 수 없습니다. approval_required를 받으면 어떤 요청이 만들어졌는지 한 줄로 요약하고 승인 카드 확인을 안내한 뒤 턴을 마칩니다.
- 승인된 작업의 실행 결과는 (시스템) 메시지로 전달될 수 있습니다. 그 내용을 근거로 후속 질문에 답합니다.`
      : `요청자는 ${role} 역할의 직원입니다. 본인 정보 조회(잔여 연차·이번 주 근무시간·내 기안 현황)를 돕습니다.

- 사용할 수 있는 도구는 본인 정보 조회뿐입니다. 다른 직원의 정보 조회나 변경 작업(계정·라이선스·그룹 등 관리 액션)은 권한이 없으므로, 요청받으면 실행을 시도하지 말고 관리자에게 문의하도록 안내합니다.`;

  return `당신은 WorkHub365의 AI 어시스턴트입니다. 한국어로, 간결하게 답합니다.

${roleContext}

- 반드시 도구 결과에 근거해 답합니다. 수치를 추측하지 않고, 조회되지 않으면 그렇게 말합니다.
- 금액은 원화(₩), 시간은 한국 표준시 기준으로 표현합니다.
- 채팅 화면은 마크다운을 렌더링하지 않습니다. 표·굵게(**)·헤더(#) 없이 일반 텍스트로 쓰고, 목록은 "- ", 구분이 필요하면 빈 줄을 사용합니다.`;
}

type IncomingMessage = { role: "user" | "assistant"; content: unknown };

// 클라이언트가 왕복 보관하는 원본 블록만 허용 — 임의 구조가 Anthropic API까지
// 흘러가 원문 에러가 노출되는 것을 조기 차단한다
const ALLOWED_BLOCK_TYPES = new Set([
  "text",
  "tool_use",
  "tool_result",
  "thinking",
  "redacted_thinking",
]);

function isValidContent(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every(
    (b) =>
      typeof b === "object" &&
      b !== null &&
      ALLOWED_BLOCK_TYPES.has((b as { type?: string }).type ?? ""),
  );
}

function validateBody(body: unknown):
  | { ok: true; messages: IncomingMessage[] }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || !("messages" in body)) {
    return { ok: false, error: "INVALID_JSON" };
  }
  const messages = (body as { messages: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: "INVALID_MESSAGES" };
  }
  if (messages.length > MAX_MESSAGES) {
    return { ok: false, error: "TOO_MANY_MESSAGES" };
  }
  for (const m of messages) {
    if (
      typeof m !== "object" ||
      m === null ||
      ((m as IncomingMessage).role !== "user" &&
        (m as IncomingMessage).role !== "assistant") ||
      !isValidContent((m as IncomingMessage).content)
    ) {
      return { ok: false, error: "INVALID_MESSAGES" };
    }
  }
  return { ok: true, messages: messages as IncomingMessage[] };
}

export async function POST(req: Request) {
  let session;
  try {
    // R5.1: 로그인한 전 직원 사용 가능 — 도구는 아래에서 역할별로 필터된다
    session = await assertSession();
  } catch {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const actorId = session.user.id;
  const actorRole: Role = session.user.role;

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY_MISSING" }, { status: 500 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) {
    return Response.json({ error: "BODY_TOO_LARGE" }, { status: 413 });
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const validated = validateBody(parsedBody);
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: 400 });
  }

  const anthropic = new Anthropic();
  const model = process.env.ASSISTANT_MODEL ?? "claude-sonnet-5";
  // 게이트 1차: 세션 역할이 사용할 수 있는 도구만 모델에 노출한다
  const anthropicTools = toolsForRole(actorRole).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toolInputJsonSchema(t) as Anthropic.Tool["input_schema"],
  }));

  const encoder = new TextEncoder();
  let clientGone = false;
  let resolveLoopDone!: () => void;
  const loopDone = new Promise<void>((r) => {
    resolveLoopDone = r;
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // 클라이언트가 떠나도 루프는 계속 — 감사 로그·승인 요청 생성은 완료돼야 한다
          clientGone = true;
        }
      };

      let messages = validated.messages as Anthropic.MessageParam[];
      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const msgStream = anthropic.messages.stream({
            model,
            max_tokens: 8192,
            system: systemPromptFor(actorRole),
            tools: anthropicTools,
            messages,
          });
          msgStream.on("text", (delta) => send({ type: "delta", text: delta }));
          const message = await msgStream.finalMessage();

          // 잘림/거절 안내는 append(스트리밍 종료 신호)보다 먼저 보내야
          // 클라이언트가 유령 말풍선을 만들지 않는다
          if (message.stop_reason === "max_tokens") {
            send({ type: "delta", text: "\n\n(응답이 길이 제한으로 잘렸습니다)" });
          }
          if (message.stop_reason === "refusal") {
            send({
              type: "delta",
              text: "안전상의 이유로 이 요청에는 응답할 수 없습니다. 질문을 바꿔 다시 시도해 주세요.",
            });
          }

          // 원본 블록(thinking 포함)을 클라이언트 이력에 보관시킨다.
          // 빈 content(거절 등)는 이력에 넣으면 다음 요청이 400이 되므로 제외
          if (message.content.length > 0) {
            send({
              type: "append",
              message: { role: "assistant", content: message.content },
            });
            messages = [
              ...messages,
              { role: "assistant", content: message.content },
            ];
          }

          if (message.stop_reason !== "tool_use") {
            send({ done: true, ok: true });
            break;
          }

          const toolUses = message.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            send({ type: "tool", name: tu.name });
            const outcome = await runAssistantToolUse({
              toolUseId: tu.id,
              name: tu.name,
              input: tu.input,
              actorId,
              actorRole,
            });
            if (!outcome.auditOk) {
              // R5.4 — 감사 기록 실패를 침묵하지 않는다 (lifecycle 관행)
              send({ type: "warning", code: "AUDIT_WRITE_FAILED" });
            }
            if (outcome.type === "approval") {
              send({
                type: "approval",
                requestId: outcome.requestId,
                toolName: outcome.toolName,
                summary: outcome.summary,
                input: outcome.input,
                expiresAt: outcome.expiresAt,
              });
              results.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify(outcome.forModel),
              });
            } else {
              send({
                type: "tool_done",
                name: tu.name,
                ok: outcome.ok,
                brief: outcome.brief,
              });
              results.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify(outcome.forModel),
                is_error: !outcome.ok,
              });
            }
          }
          const resultMessage: Anthropic.MessageParam = {
            role: "user",
            content: results,
          };
          send({ type: "append", message: resultMessage });
          messages = [...messages, resultMessage];

          if (round === MAX_ROUNDS - 1) {
            send({
              done: true,
              ok: false,
              error: "도구 호출 한도를 초과했습니다. 질문을 나눠서 다시 시도하세요.",
            });
          }
        }
      } catch (e) {
        // 원문(e.message)에는 업스트림 API 상세가 섞일 수 있어 일반화해 내려보낸다
        console.error("[assistant] tool use 루프 오류:", e);
        send({
          done: true,
          ok: false,
          error: "어시스턴트 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        });
      } finally {
        try {
          controller.close();
        } catch {
          // 이미 닫힘
        }
        resolveLoopDone();
      }
    },
  });

  // 클라이언트가 스트림을 끊어도 도구 실행·감사 기록이 끝날 때까지 유지
  after(() => loopDone);

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
