import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests, auditLogs } from "@/db/schema";
import { expiryFrom } from "@/lib/approval";
import { getSubscribedSkus } from "@/lib/graph/licenses";
import { lookupGroupBasic, lookupUserBasic } from "@/lib/graph/users";
import { buildPriceMap } from "@/lib/sku-prices";
import {
  executeTool,
  getTool,
} from "../../../packages/mcp-server/src/tools";
import type { Role, ToolContext } from "../../../packages/mcp-server/src/types";
import { createAssistantOps, type AssistantActor } from "./ops";

// /api/assistant tool use 루프의 도구 처리부.
// - 조회형: 즉시 실행 + 감사 로그 (R5.4 — 어시스턴트의 모든 도구 실행 기록)
// - 변경형: approval_requests 행 생성 후 approval_required 반환 (실행하지 않음)
//   실제 실행은 승인 카드 서버 액션(actions.ts)이 CAS 클레임 후 수행한다.
//
// 승인 요청을 만들기 직전에 입력의 GUID(userId·skuId·groupId)를 app-only Graph로
// 이름으로 해석해 payload에 함께 저장한다. 승인 게이트의 가치는 게이트의 존재가
// 아니라 승인자가 무엇을 보고 판단하는가에 있으므로, 카드가 GUID만 보여주면
// 승인은 형식적 절차가 된다. 해석은 게이트 앞뒤 어디도 건드리지 않는다 —
// executeTool은 여전히 approval_required를 반환하고 실행은 승인 후에만 일어난다.

let ctxSingleton: ToolContext | null = null;
/**
 * actor를 주면 자기 자신 차단·세션 철회 가드가 활성화된 컨텍스트를 만든다.
 * ops는 클로저 묶음일 뿐이라 요청마다 생성해도 비용이 없다 — actor 없는 호출만
 * 기존처럼 싱글턴을 재사용한다(가드는 비교 대상이 없어 정규화만 수행).
 */
export function assistantCtx(actor?: AssistantActor): ToolContext {
  if (actor) return createAssistantOps(actor);
  ctxSingleton ??= createAssistantOps();
  return ctxSingleton;
}

/**
 * 승인 카드가 GUID 대신 보여줄, 해석된 대상. 승인 요청 payload와 감사 로그에
 * 함께 저장되고 클라이언트(승인 카드)로도 전달된다.
 */
export type ApprovalTargets = {
  user?: { id: string; displayName: string; userPrincipalName: string };
  skus?: { id: string; displayName: string }[];
  groups?: { id: string; displayName: string }[];
  /**
   * Graph 일시 장애로 이름 해석을 건너뛴 사유. 대상 부재와 달리 요청은 만들되,
   * 승인자가 GUID만 보게 된 이유를 기록해 둔다.
   */
  unresolved?: string;
};

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
      targets: ApprovalTargets;
      expiresAt: string;
      /** tool_result 블록으로 모델에 전달할 내용 */
      forModel: unknown;
      auditOk: boolean;
    };

// ── 승인 대상 해석 ────────────────────────────────────────────────────────

type TargetResolution =
  | { ok: true; targets: ApprovalTargets }
  | { ok: false; message: string };

/** 승인 카드 제목에 쓰는 액션 라벨 — 도구 이름(block_user)은 승인자의 언어가 아니다 */
const ACTION_LABELS: Record<string, string> = {
  create_user: "계정 생성",
  block_user: "계정 차단",
  revoke_user_sessions: "세션 철회",
  remove_user_license: "라이선스 회수",
  remove_user_from_group: "그룹 제거",
};

/** 입력에서 해석 대상 GUID를 모은다 — 단수(userId/skuId/groupId)·복수(skuIds/groupIds) 모두 */
function collectTargetIds(input: unknown): {
  userId?: string;
  skuIds: string[];
  groupIds: string[];
} {
  const i = (input ?? {}) as Record<string, unknown>;
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    userId: typeof i.userId === "string" ? i.userId : undefined,
    skuIds: [
      ...(typeof i.skuId === "string" ? [i.skuId] : []),
      ...asStrings(i.skuIds),
    ],
    groupIds: [
      ...(typeof i.groupId === "string" ? [i.groupId] : []),
      ...asStrings(i.groupIds),
    ],
  };
}

function transientReason(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return `대상 이름을 해석하지 못했습니다 (Graph 일시 오류): ${message}`;
}

/**
 * 승인 요청 payload에 넣을 대상 이름을 app-only Graph로 해석한다.
 *
 * - 대상이 존재하지 않으면 ok:false — 승인 요청을 만들지 않는다. 존재하지 않는
 *   GUID에 "승인하고 실행" 버튼이 달리면 승인자가 검증할 수 없는 것을 승인하게 된다.
 * - Graph 일시 장애(429·5xx·타임아웃·권한 오류)는 부재의 증거가 아니다. 부재는
 *   404/형식 오류로 확정할 수 있지만 일시 장애는 재시도하면 달라지므로, 여기서
 *   요청을 막으면 승인 게이트가 Graph 가용성에 종속된다. 이름 없이 진행하되
 *   사유를 targets.unresolved에 남겨 승인자가 "이름이 안 보이는 이유"를 알게 한다.
 */
async function resolveApprovalTargets(
  input: unknown,
): Promise<TargetResolution> {
  const { userId, skuIds, groupIds } = collectTargetIds(input);
  const targets: ApprovalTargets = {};
  let unresolved: string | undefined;

  if (userId) {
    try {
      const user = await lookupUserBasic(userId);
      if (!user) {
        return {
          ok: false,
          message: `대상 사용자를 찾을 수 없습니다 (id ${userId}). find_users로 대상을 다시 확인한 뒤 요청하세요.`,
        };
      }
      targets.user = user;
    } catch (e) {
      unresolved ??= transientReason(e);
    }
  }

  if (skuIds.length > 0) {
    try {
      // 라이선스 화면·get_license_overview와 동일 경로 재사용 (구독 SKU + 단가표 표시명)
      const skus = await getSubscribedSkus();
      const prices = await buildPriceMap(skus);
      const resolved: { id: string; displayName: string }[] = [];
      for (const skuId of skuIds) {
        const sku = skus.find((s) => s.skuId === skuId);
        if (!sku) {
          return {
            ok: false,
            message: `테넌트가 구독하지 않은 라이선스입니다 (skuId ${skuId}). get_license_overview로 skuId를 확인하세요.`,
          };
        }
        resolved.push({
          id: skuId,
          displayName: prices.get(skuId)?.displayName ?? sku.skuPartNumber,
        });
      }
      targets.skus = resolved;
    } catch (e) {
      unresolved ??= transientReason(e);
    }
  }

  if (groupIds.length > 0) {
    try {
      const resolved: { id: string; displayName: string }[] = [];
      for (const groupId of groupIds) {
        const group = await lookupGroupBasic(groupId);
        if (!group) {
          return {
            ok: false,
            message: `대상 그룹을 찾을 수 없습니다 (id ${groupId}). list_groups로 그룹 id를 확인하세요.`,
          };
        }
        resolved.push({ id: group.id, displayName: group.displayName });
      }
      targets.groups = resolved;
    } catch (e) {
      unresolved ??= transientReason(e);
    }
  }

  if (unresolved) targets.unresolved = unresolved;
  return { ok: true, targets };
}

/**
 * 해석된 이름으로 승인 요약 문장을 재작성한다.
 * mcp-server의 summarize는 DB·Graph에 의존하지 않는 것이 기존 구조라 GUID 축약이
 * 한계다 — 이름 보강은 해석 결과를 가진 호스트(웹앱)인 여기서 한다.
 * 이름을 하나도 얻지 못하면 도구의 원래 요약(축약 GUID)을 그대로 쓴다.
 */
function buildApprovalSummary(
  toolName: string,
  input: unknown,
  targets: ApprovalTargets,
  fallback: string,
): string {
  const label = ACTION_LABELS[toolName];
  if (!label) return fallback;

  const i = (input ?? {}) as Record<string, unknown>;
  // create_user는 아직 존재하지 않는 대상이므로 입력값 자체가 사람이 읽는 이름이다
  const newUser =
    typeof i.displayName === "string"
      ? `${i.displayName}${typeof i.mailNickname === "string" ? ` (${i.mailNickname})` : ""}`
      : null;
  const who = targets.user
    ? `${targets.user.displayName} (${targets.user.userPrincipalName})`
    : newUser;

  const extras: string[] = [];
  if (targets.skus?.length) {
    extras.push(`라이선스 ${targets.skus.map((s) => s.displayName).join(", ")}`);
  }
  if (targets.groups?.length) {
    extras.push(`그룹 ${targets.groups.map((g) => g.displayName).join(", ")}`);
  }

  if (!who && extras.length === 0) return fallback;
  const head = who ? `${label} · ${who}` : label;
  return extras.length > 0 ? `${head} — ${extras.join(" · ")}` : head;
}

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
  /** 세션 역할 — executeTool의 minRole 게이트 재검증(2차)에 사용 (R5.1) */
  actorRole: Role;
}): Promise<ToolUseOutcome> {
  const { toolUseId, name, input, actorId, actorRole } = opts;
  const out = await executeTool(name, input, assistantCtx({ userId: actorId }), {
    actor: { userId: actorId, role: actorRole },
  });

  if (out.kind === "approval_required") {
    // 승인 카드에 실을 대상 이름 해석. 대상이 존재하지 않으면 승인 요청 자체를
    // 만들지 않고 오류로 되돌린다 (게이트는 그대로 — 실행된 것은 아무것도 없다)
    const resolved = await resolveApprovalTargets(out.input);
    if (!resolved.ok) {
      const auditOk = await audit({
        actorId,
        action: "assistant.approval.request",
        detail: { toolName: out.toolName, input: out.input, error: resolved.message },
        success: false,
      });
      return {
        type: "result",
        ok: false,
        forModel: { error: resolved.message },
        brief: out.summary,
        auditOk,
      };
    }
    const targets = resolved.targets;
    const summary = buildApprovalSummary(
      out.toolName,
      out.input,
      targets,
      out.summary,
    );

    const expiresAt = expiryFrom(new Date());
    // 멱등 삽입: 같은 tool_use가 재시도돼도 요청은 1건만 생성된다
    const inserted = await db
      .insert(approvalRequests)
      .values({
        kind: "assistant_action",
        toolName: out.toolName,
        payload: { input: out.input, summary, targets },
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
      detail: { toolName: out.toolName, summary, input: out.input, targets },
      success: true,
    });

    return {
      type: "approval",
      requestId: row.id,
      toolName: out.toolName,
      summary,
      input: out.input,
      targets,
      expiresAt: (row.expiresAt ?? expiresAt).toISOString(),
      forModel: {
        status: "approval_required",
        requestId: row.id,
        summary,
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

  // actor_required는 웹 경로에선 발생하지 않아야 한다(항상 actor 주입) —
  // 발생하면 구조 결함이므로 오류로 표면화한다
  const errorMessage =
    out.kind === "actor_required"
      ? "이 도구는 로그인 사용자 컨텍스트가 필요합니다 (서버 구성 오류)"
      : out.message;

  const auditOk = await audit({
    actorId,
    action: `assistant.tool.${name}`,
    detail: { input, error: errorMessage },
    success: false,
  });
  return {
    type: "result",
    ok: false,
    forModel: { error: errorMessage },
    brief,
    auditOk,
  };
}
