"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLogs, proposalApprovers, proposals, users } from "@/db/schema";
import { assertRole } from "@/lib/auth-helpers";
import type { ActionState } from "@/components/action-form";
import {
  getTemplate,
  nextProposalState,
  validateContent,
  validateLine,
} from "@/lib/proposal";
import { actionErrorMessage, isUuid } from "@/lib/validate";

export async function createProposal(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin", "manager", "employee");

  const templateKey = String(formData.get("templateKey") ?? "");
  const template = getTemplate(templateKey);
  if (!template) return { error: "기안 유형이 올바르지 않습니다" };

  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) return { error: "제목을 입력하세요" };

  // 템플릿 필드 값 수집·검증 (정의된 필드만 스냅샷)
  const raw: Record<string, unknown> = {};
  for (const f of template.fields) raw[f.key] = formData.get(`field:${f.key}`);
  const validated = validateContent(template, raw);
  if (!validated.ok) return { error: validated.error };

  // 결재선: JSON 배열(userId 순서대로)
  let approverIds: string[];
  try {
    approverIds = JSON.parse(String(formData.get("approverIds") ?? "[]"));
    if (!Array.isArray(approverIds) || !approverIds.every((x) => typeof x === "string")) {
      throw new Error();
    }
  } catch {
    return { error: "결재선 형식이 올바르지 않습니다" };
  }
  const lineCheck = validateLine(approverIds, session.user.id);
  if (!lineCheck.ok) return { error: lineCheck.error };

  // uuid 형태 사전 검증 — 위조 값이 raw Postgres 캐스팅 오류로 새지 않게
  if (!approverIds.every(isUuid)) {
    return { error: "존재하지 않는 결재자가 포함되어 있습니다" };
  }

  try {
    // 결재자 실재 확인 (조작 방어)
    const found = await db.query.users.findMany({
      where: inArray(users.id, approverIds),
    });
    if (found.length !== approverIds.length) {
      return { error: "존재하지 않는 결재자가 포함되어 있습니다" };
    }

    await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(proposals)
      .values({
        templateKey,
        title,
        authorId: session.user.id,
        content: validated.content,
      })
      .returning({ id: proposals.id });

    await tx.insert(proposalApprovers).values(
      approverIds.map((approverId, i) => ({
        proposalId: created.id,
        step: i + 1,
        approverId,
      })),
    );

    await tx.insert(auditLogs).values({
      actorId: session.user.id,
      actorType: "user",
      action: "proposal.submit",
      targetType: "proposal",
      targetId: created.id,
      detail: { templateKey, title, approverIds },
      success: true,
    });
    });
  } catch (e) {
    console.error("createProposal 실패:", e);
    return { error: "기안 상신에 실패했습니다. 잠시 후 다시 시도하세요" };
  }

  revalidatePath("/proposals");
  revalidatePath("/proposals/inbox");
  return { ok: true };
}

export async function decideProposal(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin", "manager", "employee");
  const proposalId = String(formData.get("proposalId") ?? "");
  const action = String(formData.get("action") ?? "") as "approve" | "reject";
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 500) || null;

  if (!isUuid(proposalId) || (action !== "approve" && action !== "reject")) {
    return { error: "입력이 올바르지 않습니다" };
  }
  if (action === "reject" && !comment) {
    return { error: "반려 사유를 입력하세요" };
  }

  try {
    await db.transaction(async (tx) => {
      const proposal = await tx.query.proposals.findFirst({
        where: eq(proposals.id, proposalId),
      });
      if (!proposal) throw new Error("기안을 찾을 수 없습니다");
      if (proposal.status !== "in_progress")
        throw new Error("이미 종결된 기안입니다");

      const line = await tx.query.proposalApprovers.findMany({
        where: eq(proposalApprovers.proposalId, proposalId),
      });
      const mine = line.find(
        (a) => a.step === proposal.currentStep && a.approverId === session.user.id,
      );
      if (!mine) throw new Error("현재 결재 차례가 아닙니다");

      const result = nextProposalState(proposal.currentStep, line.length, action);
      if (!result.ok) throw new Error(result.reason);

      // 낙관적 가드 1: 내 결재 행이 아직 대기일 때만 처리 (더블클릭·동시 처리 차단)
      const decided = await tx
        .update(proposalApprovers)
        .set({
          status: action === "approve" ? "approved" : "rejected",
          comment,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(proposalApprovers.id, mine.id),
            eq(proposalApprovers.status, "pending"),
          ),
        )
        .returning({ id: proposalApprovers.id });
      if (decided.length === 0) throw new Error("이미 처리된 결재입니다");

      // 낙관적 가드 2: 기안이 같은 단계·진행 중일 때만 전이
      const advanced = await tx
        .update(proposals)
        .set({
          status: result.proposalStatus,
          currentStep: result.nextStep,
          decidedAt: result.proposalStatus === "in_progress" ? null : new Date(),
        })
        .where(
          and(
            eq(proposals.id, proposalId),
            eq(proposals.status, "in_progress"),
            eq(proposals.currentStep, proposal.currentStep),
          ),
        )
        .returning({ id: proposals.id });
      if (advanced.length === 0) throw new Error("기안 상태가 변경되었습니다. 새로고침 후 다시 시도하세요");

      await tx.insert(auditLogs).values({
        actorId: session.user.id,
        actorType: "user",
        action: `proposal.${action}`,
        targetType: "proposal",
        targetId: proposalId,
        detail: {
          step: proposal.currentStep,
          nextStatus: result.proposalStatus,
          comment,
        },
        success: true,
      });
    });
  } catch (e) {
    // 앱이 던진 메시지("이미 종결된 기안입니다")는 그대로, 드라이버 오류 원문은 접는다
    return { error: actionErrorMessage(e, "처리에 실패했습니다") };
  }

  // B12: 상세는 마스터-디테일 화면(?sel)로 통합 — 두 목록 라우트를 갱신한다
  revalidatePath("/proposals");
  revalidatePath("/proposals/inbox");
  return { ok: true };
}

export async function cancelProposal(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin", "manager", "employee");
  const proposalId = String(formData.get("proposalId") ?? "");
  if (!isUuid(proposalId)) return { error: "입력이 올바르지 않습니다" };

  try {
    await db.transaction(async (tx) => {
      const proposal = await tx.query.proposals.findFirst({
        where: eq(proposals.id, proposalId),
      });
      if (!proposal) throw new Error("기안을 찾을 수 없습니다");
      if (proposal.authorId !== session.user.id)
        throw new Error("본인 기안만 회수할 수 있습니다");

      // 누군가 결재를 시작했으면 회수 불가
      const touched = await tx.query.proposalApprovers.findFirst({
        where: and(
          eq(proposalApprovers.proposalId, proposalId),
          ne(proposalApprovers.status, "pending"),
        ),
      });
      if (touched) throw new Error("이미 결재가 진행되어 회수할 수 없습니다");

      // in_progress AND currentStep=1 ⟺ 아무도 결재하지 않음 — 위의 touched 검사는
      // 친절한 오류용이고, 동시 승인과의 경합은 이 조건부 UPDATE가 막는다
      // (승인이 먼저 커밋되면 currentStep 전진 또는 상태 종결로 여기서 0행)
      const cancelled = await tx
        .update(proposals)
        .set({ status: "cancelled", decidedAt: new Date() })
        .where(
          and(
            eq(proposals.id, proposalId),
            eq(proposals.status, "in_progress"),
            eq(proposals.currentStep, 1),
          ),
        )
        .returning({ id: proposals.id });
      if (cancelled.length === 0)
        throw new Error("이미 결재가 진행되었거나 종결된 기안입니다");

      await tx.insert(auditLogs).values({
        actorId: session.user.id,
        actorType: "user",
        action: "proposal.cancel",
        targetType: "proposal",
        targetId: proposalId,
        detail: { title: proposal.title },
        success: true,
      });
    });
  } catch (e) {
    // 앱이 던진 메시지("이미 종결된 기안입니다")는 그대로, 드라이버 오류 원문은 접는다
    return { error: actionErrorMessage(e, "처리에 실패했습니다") };
  }

  // B12: 상세는 마스터-디테일 화면(?sel)로 통합 — 두 목록 라우트를 갱신한다
  revalidatePath("/proposals");
  revalidatePath("/proposals/inbox");
  return { ok: true };
}

/**
 * 관리자 강제 반려 — 결재자가 퇴사 등으로 결재 불능일 때의 회복 경로.
 * 사유 필수, 감사 로그 기록. 조건부 전이로 동시 결재와 경합해도 한쪽만 성공
 */
export async function adminForceReject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin");
  const proposalId = String(formData.get("proposalId") ?? "");
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 500);
  if (!isUuid(proposalId)) return { error: "입력이 올바르지 않습니다" };
  if (!comment) return { error: "강제 반려 사유를 입력하세요" };

  try {
    await db.transaction(async (tx) => {
      const rejected = await tx
        .update(proposals)
        .set({ status: "rejected", decidedAt: new Date() })
        .where(
          and(eq(proposals.id, proposalId), eq(proposals.status, "in_progress")),
        )
        .returning({ id: proposals.id, title: proposals.title });
      if (rejected.length === 0) throw new Error("이미 종결된 기안입니다");

      await tx.insert(auditLogs).values({
        actorId: session.user.id,
        actorType: "user",
        action: "proposal.force_reject",
        targetType: "proposal",
        targetId: proposalId,
        detail: { title: rejected[0].title, comment },
        success: true,
      });
    });
  } catch (e) {
    // 앱이 던진 메시지("이미 종결된 기안입니다")는 그대로, 드라이버 오류 원문은 접는다
    return { error: actionErrorMessage(e, "처리에 실패했습니다") };
  }

  // B12: 상세는 마스터-디테일 화면(?sel)로 통합 — 두 목록 라우트를 갱신한다
  revalidatePath("/proposals");
  revalidatePath("/proposals/inbox");
  return { ok: true };
}
