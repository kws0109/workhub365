import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests, auditLogs } from "@/db/schema";
import { expiryFrom } from "@/lib/approval";
import {
  executeTool,
  getTool,
} from "../../../packages/mcp-server/src/tools";
import type { ToolContext } from "../../../packages/mcp-server/src/types";
import { createAssistantOps } from "./ops";

// /api/assistant tool use 루프의 도구 처리부.
// - 조회형: 즉시 실행 + 감사 로그 (R5.4 — 어시스턴트의 모든 도구 실행 기록)
// - 변경형: approval_requests 행 생성 후 approval_required 반환 (실행하지 않음)
//   실제 실행은 승인 카드 서버 액션(actions.ts)이 CAS 클레임 후 수행한다.

let ctxSingleton: ToolContext | null = null;
export function assistantCtx(): ToolContext {
  ctxSingleton ??= createAssistantOps();
  return ctxSingleton;
}

export type ToolUseOutcome =
  | {
      type: "result";
      ok: boolean;
      /** tool_result 블록으로 모델에 전달할 내용 */
      forModel: unknown;
      brief: string;
      /** 감사 로그 기록 성공 여부 — false면 호출부가 경고를 표면화한다 (R5.4) */
      auditOk: boolean;
    }
  | {
      type: "approval";
      requestId: string;
      toolName: string;
      summary: string;
      input: unknown;
      expiresAt: string;
      /** tool_result 블록으로 모델에 전달할 내용 */
      forModel: unknown;
      auditOk: boolean;
    };

/** 감사 로그 기록. 실패해도 도구 흐름을 깨지 않는다 (경고만) */
async function audit(entry: {
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: unknown;
  success: boolean;
}): Promise<boolean> {
  try {
    await db.insert(auditLogs).values({
      actorId: entry.actorId,
      actorType: "assistant",
      action: entry.action,
      targetType: entry.targetType ?? "assistant_tool",
      targetId: entry.targetId,
      detail: entry.detail,
      success: entry.success,
    });
    return true;
  } catch (e) {
    // 감사 기록 실패를 도구 실패로 오인시키지 않되, 침묵하지도 않는다
    // (lifecycle 라우트의 AUDIT_WRITE_FAILED 관행과 동일)
    console.error("[assistant] 감사 로그 기록 실패:", entry.action, e);
    return false;
  }
}

/** 결과가 커도 감사 로그가 비대해지지 않게 자른 미리보기 */
function preview(value: unknown, max = 2000): string {
  const s = JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}…(truncated)` : s;
}

export async function runAssistantToolUse(opts: {
  /** Claude tool_use 블록 id — 승인 요청 멱등 키 */
  toolUseId: string;
  name: string;
  input: unknown;
  actorId: string;
}): Promise<ToolUseOutcome> {
  const { toolUseId, name, input, actorId } = opts;
  const out = await executeTool(name, input, assistantCtx());

  if (out.kind === "approval_required") {
    const expiresAt = expiryFrom(new Date());
    // 멱등 삽입: 같은 tool_use가 재시도돼도 요청은 1건만 생성된다
    const inserted = await db
      .insert(approvalRequests)
      .values({
        kind: "assistant_action",
        toolName: out.toolName,
        payload: { input: out.input, summary: out.summary },
        idempotencyKey: toolUseId,
        requestedBy: actorId,
        expiresAt,
      })
      .onConflictDoNothing({ target: approvalRequests.idempotencyKey })
      .returning({ id: approvalRequests.id, expiresAt: approvalRequests.expiresAt });

    let row = inserted[0];
    if (!row) {
      const existing = await db
        .select({ id: approvalRequests.id, expiresAt: approvalRequests.expiresAt })
        .from(approvalRequests)
        .where(eq(approvalRequests.idempotencyKey, toolUseId))
        .limit(1);
      row = existing[0];
    }
    if (!row) throw new Error("승인 요청 저장에 실패했습니다");

    const auditOk = await audit({
      actorId,
      action: `assistant.approval.request`,
      targetType: "approval_request",
      targetId: row.id,
      detail: { toolName: out.toolName, summary: out.summary, input: out.input },
      success: true,
    });

    return {
      type: "approval",
      requestId: row.id,
      toolName: out.toolName,
      summary: out.summary,
      input: out.input,
      expiresAt: (row.expiresAt ?? expiresAt).toISOString(),
      forModel: {
        status: "approval_required",
        requestId: row.id,
        summary: out.summary,
        message:
          "관리자 승인 대기 중입니다. 화면의 승인 카드에서 관리자가 승인해야 실제로 실행됩니다. 승인을 대신하거나 재촉할 수 없습니다.",
      },
      auditOk,
    };
  }

  const tool = getTool(name);
  let brief = name;
  try {
    brief = tool ? tool.summarize(input as never) : name;
  } catch {
    // 입력이 불량하면(검증 실패 경로) 요약 대신 도구 이름만 사용
  }

  if (out.kind === "ok") {
    const auditOk = await audit({
      actorId,
      action: `assistant.tool.${name}`,
      detail: { input, result: preview(out.result) },
      success: true,
    });
    return { type: "result", ok: true, forModel: out.result, brief, auditOk };
  }

  const auditOk = await audit({
    actorId,
    action: `assistant.tool.${name}`,
    detail: { input, error: out.message },
    success: false,
  });
  return {
    type: "result",
    ok: false,
    forModel: { error: out.message },
    brief,
    auditOk,
  };
}
