"use server";

import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests, auditLogs } from "@/db/schema";
import { canDecide, type ApprovalLike } from "@/lib/approval";
import { assertRole } from "@/lib/auth-helpers";
import { assistantCtx } from "@/lib/assistant/execute";
import { executeTool } from "../../../../packages/mcp-server/src/tools";

// 승인 카드 액션. 변경형 도구가 실제로 실행되는 유일한 경로다.
// pending → executing 조건부 UPDATE(CAS)로 클레임에 성공한 요청만 실행되므로
// 두 탭에서 동시에 승인해도 정확히 1회만 실행된다 (handoff 동시성 리뷰 반영).

export type ApproveResult =
  | {
      ok: true;
      summary: string;
      result: unknown;
      /** 계정 생성 시 1회 표시용 — DB·감사 로그에는 저장되지 않는다 */
      tempPassword?: string;
      /** 실행은 성공했으나 결과 기록/감사 로그가 일부 실패한 경우의 안내 */
      warning?: string;
    }
  | { ok: false; error: string };

export type RejectResult = { ok: true } | { ok: false; error: string };

/** 실행 결과에서 민감정보(임시 비밀번호)를 분리한다 */
function splitSensitive(result: unknown): { stored: unknown; tempPassword?: string } {
  if (
    typeof result === "object" &&
    result !== null &&
    "tempPassword" in result &&
    typeof (result as { tempPassword: unknown }).tempPassword === "string"
  ) {
    const { tempPassword, ...rest } = result as { tempPassword: string } & Record<
      string,
      unknown
    >;
    return { stored: rest, tempPassword };
  }
  return { stored: result };
}

export async function approveAssistantRequest(
  requestId: string,
): Promise<ApproveResult> {
  let session;
  try {
    session = await assertRole("admin");
  } catch {
    return { ok: false, error: "권한이 없습니다" };
  }

  const rows = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId))
    .limit(1);
  const request = rows[0];
  if (!request) return { ok: false, error: "요청을 찾을 수 없습니다" };

  const now = new Date();
  const check = canDecide(request as ApprovalLike, now);
  if (!check.ok) return { ok: false, error: check.reason };

  // 실행-정확히-1회 클레임: pending이고 만료 전인 행만 executing으로 전이
  const claimed = await db
    .update(approvalRequests)
    .set({ status: "executing", decidedBy: session.user.id, decidedAt: now })
    .where(
      and(
        eq(approvalRequests.id, requestId),
        eq(approvalRequests.status, "pending"),
        or(
          isNull(approvalRequests.expiresAt),
          gt(approvalRequests.expiresAt, now),
        ),
      ),
    )
    .returning({ id: approvalRequests.id });
  if (claimed.length === 0) {
    return { ok: false, error: "이미 처리되었거나 만료된 요청입니다" };
  }

  const payload = request.payload as { input?: unknown; summary?: string };
  const summary = payload.summary ?? request.toolName;

  // 게이트 통과 실행 — approvalGranted는 이 클레임 성공 경로에서만 전달된다
  const out = await executeTool(request.toolName, payload.input, assistantCtx(), {
    approvalGranted: true,
  });

  // 실행 이후의 기록 실패가 결과 전달(특히 임시 비밀번호)을 막으면 안 된다.
  // 트랜잭션 실패 시 상태 갱신·감사 로그를 개별로 한 번 더 시도하고(불변식 4),
  // 그래도 실패하면 경고를 반환한다. 프로세스가 실행 도중 죽는 극단 케이스에는
  // 행이 executing으로 남는데, 이중 실행 방지를 우선한 의도된 트레이드오프다
  // (재승인 불가 — 감사 로그·M365 상태 확인 후 필요 시 새로 요청).
  if (out.kind === "ok") {
    const { stored, tempPassword } = splitSensitive(out.result);
    const rowUpdate = {
      status: "executed" as const,
      executedAt: new Date(),
      result: stored,
    };
    const auditEntry = {
      actorId: session.user.id,
      actorType: "assistant" as const,
      action: `assistant.tool.${request.toolName}`,
      targetType: "approval_request",
      targetId: requestId,
      detail: { summary, input: payload.input, result: stored },
      success: true,
    };
    let warning: string | undefined;
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(approvalRequests)
          .set(rowUpdate)
          .where(eq(approvalRequests.id, requestId));
        await tx.insert(auditLogs).values(auditEntry);
      });
    } catch (e) {
      console.error("[assistant] 승인 실행 결과 기록 실패 — 개별 재시도:", e);
      const retries = await Promise.allSettled([
        db
          .update(approvalRequests)
          .set(rowUpdate)
          .where(eq(approvalRequests.id, requestId)),
        db.insert(auditLogs).values(auditEntry),
      ]);
      if (retries.some((r) => r.status === "rejected")) {
        console.error("[assistant] 결과 기록 재시도도 실패:", requestId, retries);
        warning =
          "실행은 완료됐지만 결과 기록에 실패했습니다. 감사 로그와 요청 상태를 확인하세요.";
      }
    }
    return { ok: true, summary, result: stored, tempPassword, warning };
  }

  const errorMessage =
    out.kind === "error" ? out.message : "실행 경로 오류(게이트 미통과)";
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(approvalRequests)
        .set({ status: "failed", executedAt: new Date(), error: errorMessage })
        .where(eq(approvalRequests.id, requestId));
      await tx.insert(auditLogs).values({
        actorId: session.user.id,
        actorType: "assistant",
        action: `assistant.tool.${request.toolName}`,
        targetType: "approval_request",
        targetId: requestId,
        detail: { summary, input: payload.input, error: errorMessage },
        success: false,
      });
    });
  } catch (e) {
    console.error("[assistant] 승인 실행 실패 기록마저 실패:", requestId, e);
  }
  return { ok: false, error: `실행 실패: ${errorMessage}` };
}

export async function rejectAssistantRequest(
  requestId: string,
): Promise<RejectResult> {
  let session;
  try {
    session = await assertRole("admin");
  } catch {
    return { ok: false, error: "권한이 없습니다" };
  }

  const now = new Date();
  const rejected = await db
    .update(approvalRequests)
    .set({ status: "rejected", decidedBy: session.user.id, decidedAt: now })
    .where(
      and(
        eq(approvalRequests.id, requestId),
        eq(approvalRequests.status, "pending"),
      ),
    )
    .returning({ id: approvalRequests.id, toolName: approvalRequests.toolName });
  if (rejected.length === 0) {
    return { ok: false, error: "이미 처리된 요청입니다" };
  }

  await db.insert(auditLogs).values({
    actorId: session.user.id,
    actorType: "user",
    action: "assistant.approval.reject",
    targetType: "approval_request",
    targetId: requestId,
    detail: { toolName: rejected[0].toolName },
    success: true,
  });
  return { ok: true };
}
