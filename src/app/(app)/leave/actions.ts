"use server";

import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLogs, holidays, leaveRequests, users } from "@/db/schema";
import { assertRole } from "@/lib/auth-helpers";
import type { ActionState } from "@/components/action-form";
import { getHolidaySet, syncPublicHolidays } from "@/lib/holidays";
import {
  countLeaveDays,
  transitionLeave,
  type LeaveAction,
  type LeaveType,
} from "@/lib/leave";

const LEAVE_TYPES: LeaveType[] = ["annual", "half", "sick"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createLeave(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin", "manager", "employee");

  const type = String(formData.get("type") ?? "") as LeaveType;
  const startDate = String(formData.get("startDate") ?? "");
  const reason = String(formData.get("reason") ?? "").slice(0, 500) || null;
  // 반차는 하루짜리, 연차·병가도 종료일 미입력 시 하루로 처리
  const endRaw = String(formData.get("endDate") ?? "");
  const endDate = type === "half" || !endRaw ? startDate : endRaw;

  if (!LEAVE_TYPES.includes(type) || !DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return { error: "입력이 올바르지 않습니다" };
  }

  const holidaySet = await getHolidaySet(startDate, endDate);
  const days = countLeaveDays(type, startDate, endDate, holidaySet);
  if (days <= 0) {
    return {
      error:
        startDate === endDate
          ? "주말·공휴일에는 휴가를 신청할 수 없습니다"
          : "기간에 근무일이 없거나 순서가 잘못되었습니다",
    };
  }

  // 겹치는 활성 신청(대기/1차/승인) 사전 검사 — 친절한 오류 메시지용.
  // 실제 보장은 DB의 EXCLUDE 제약(leave_requests_no_overlap)이 한다:
  // 동시 제출의 TOCTOU는 여기서 못 막고, 아래 insert의 23P01로 잡힌다
  const overlapping = await db.query.leaveRequests.findFirst({
    where: and(
      eq(leaveRequests.userId, session.user.id),
      inArray(leaveRequests.status, ["pending", "approved_1", "approved"]),
      lte(leaveRequests.startDate, endDate),
      gte(leaveRequests.endDate, startDate),
    ),
  });
  if (overlapping) {
    return { error: "해당 기간과 겹치는 신청이 이미 있습니다" };
  }

  if (type !== "sick") {
    const me = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    });
    if (!me || Number(me.annualLeaveDays) < days) {
      return { error: "잔여 연차가 부족합니다" };
    }
  }

  try {
    await db.insert(leaveRequests).values({
      userId: session.user.id,
      type,
      startDate,
      endDate,
      days: String(days),
      reason,
    });
  } catch (e) {
    // 23P01 = exclusion_violation — 동시 제출로 겹침이 생긴 경우
    if ((e as { code?: string })?.code === "23P01") {
      return { error: "해당 기간과 겹치는 신청이 이미 있습니다" };
    }
    throw e;
  }
  revalidatePath("/leave");
  return { ok: true };
}

export async function decideLeave(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin", "manager");
  const requestId = String(formData.get("requestId") ?? "");
  const action = String(formData.get("action") ?? "") as LeaveAction;
  const rejectReason =
    String(formData.get("rejectReason") ?? "").slice(0, 500) || null;

  if (!requestId || (action !== "approve" && action !== "reject")) {
    return { error: "입력이 올바르지 않습니다" };
  }
  if (action === "reject" && !rejectReason) {
    return { error: "반려 사유를 입력하세요" };
  }

  try {
    await db.transaction(async (tx) => {
      const req = await tx.query.leaveRequests.findFirst({
        where: eq(leaveRequests.id, requestId),
      });
      if (!req) throw new Error("신청을 찾을 수 없습니다");

      // 결재선 범위: manager는 자기 부서의 신청만 결재할 수 있다 (admin은 전체)
      if (session.user.role === "manager") {
        const [requester, approver] = await Promise.all([
          tx.query.users.findFirst({ where: eq(users.id, req.userId) }),
          tx.query.users.findFirst({ where: eq(users.id, session.user.id) }),
        ]);
        if (
          !approver?.department ||
          requester?.department !== approver.department
        ) {
          throw new Error("다른 부서의 신청은 결재할 수 없습니다");
        }
      }

      const result = transitionLeave(
        {
          userId: req.userId,
          type: req.type,
          status: req.status,
          days: Number(req.days),
          approverId: req.approverId,
        },
        action,
        { id: session.user.id, role: session.user.role },
      );
      if (!result.ok) throw new Error(result.reason);

      // 최종 승인 직전, 겹치는 다른 승인 건이 생기지 않았는지 재확인
      if (result.nextStatus === "approved") {
        const conflict = await tx.query.leaveRequests.findFirst({
          where: and(
            eq(leaveRequests.userId, req.userId),
            eq(leaveRequests.status, "approved"),
            ne(leaveRequests.id, req.id),
            lte(leaveRequests.startDate, req.endDate),
            gte(leaveRequests.endDate, req.startDate),
          ),
        });
        if (conflict) throw new Error("겹치는 승인 건이 이미 존재합니다");
      }

      // 낙관적 가드: 읽은 스냅샷 그대로일 때만 전이 — 동시 결재의 이중 처리 차단.
      // type·days까지 거는 이유: 인사 정정(R3.9)이 결재 중에 유형·일수를 바꾸면
      // 옛 값으로 차감하고 행에는 새 값이 남아 "총 연차 = 잔여 + 승인 사용분"이 깨진다.
      // req.days는 numeric이라 드라이버가 문자열로 준다 — Number()로 감싸면
      // 타입 불일치로 항상 0행이 되어 모든 결재가 실패한다 (원본 그대로 비교할 것)
      const updated = await tx
        .update(leaveRequests)
        .set({
          status: result.nextStatus,
          approverId: session.user.id,
          rejectReason: action === "reject" ? rejectReason : null,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(leaveRequests.id, requestId),
            eq(leaveRequests.status, req.status),
            eq(leaveRequests.type, req.type),
            eq(leaveRequests.days, req.days),
          ),
        )
        .returning({ id: leaveRequests.id });
      if (updated.length === 0) {
        throw new Error("신청이 이미 처리되었거나 내용이 변경되었습니다");
      }

      if (result.deductDays > 0) {
        const deducted = await tx
          .update(users)
          .set({
            annualLeaveDays: sql`${users.annualLeaveDays} - ${result.deductDays}`,
          })
          .where(
            and(
              eq(users.id, req.userId),
              gte(users.annualLeaveDays, String(result.deductDays)),
            ),
          )
          .returning({ id: users.id });
        if (deducted.length === 0) {
          throw new Error("잔여 연차가 부족해 승인할 수 없습니다");
        }
      }

      await tx.insert(auditLogs).values({
        actorId: session.user.id,
        actorType: "user",
        action: `leave.${action}`,
        targetType: "leave_request",
        targetId: requestId,
        detail: {
          nextStatus: result.nextStatus,
          deductDays: result.deductDays,
          rejectReason,
        },
        success: true,
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "처리에 실패했습니다" };
  }

  revalidatePath("/leave");
  return { ok: true };
}

export async function cancelLeave(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin", "manager", "employee");
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return { error: "입력이 올바르지 않습니다" };

  const req = await db.query.leaveRequests.findFirst({
    where: eq(leaveRequests.id, requestId),
  });
  if (!req) return { error: "신청을 찾을 수 없습니다" };

  const result = transitionLeave(
    {
      userId: req.userId,
      type: req.type,
      status: req.status,
      days: Number(req.days),
      approverId: req.approverId,
    },
    "cancel",
    { id: session.user.id, role: session.user.role },
  );
  if (!result.ok) return { error: result.reason };

  const updated = await db
    .update(leaveRequests)
    .set({ status: "cancelled", decidedAt: new Date() })
    .where(and(eq(leaveRequests.id, requestId), eq(leaveRequests.status, "pending")))
    .returning({ id: leaveRequests.id });
  if (updated.length === 0) return { error: "이미 처리된 신청입니다" };

  revalidatePath("/leave");
  return { ok: true };
}

// ── 휴일 관리 (admin) ─────────────────────────────────────

export async function addCompanyHoliday(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin");
  const date = String(formData.get("date") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  if (!DATE_RE.test(date) || !name) {
    return { error: "날짜와 이름을 입력하세요" };
  }

  const inserted = await db
    .insert(holidays)
    .values({ date, name, source: "company", createdBy: session.user.id })
    .onConflictDoNothing()
    .returning({ id: holidays.id });
  if (inserted.length === 0) {
    return { error: "해당 날짜에 이미 휴일이 있습니다" };
  }

  await db.insert(auditLogs).values({
    actorId: session.user.id,
    actorType: "user",
    action: "holiday.add",
    targetType: "holiday",
    targetId: date,
    detail: { name },
    success: true,
  });
  revalidatePath("/leave");
  return { ok: true };
}

export async function deleteHoliday(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "입력이 올바르지 않습니다" };

  const deleted = await db
    .delete(holidays)
    .where(eq(holidays.id, id))
    .returning({ date: holidays.date, name: holidays.name });
  if (deleted.length === 0) return { error: "휴일을 찾을 수 없습니다" };

  await db.insert(auditLogs).values({
    actorId: session.user.id,
    actorType: "user",
    action: "holiday.delete",
    targetType: "holiday",
    targetId: deleted[0].date,
    detail: { name: deleted[0].name },
    success: true,
  });
  revalidatePath("/leave");
  return { ok: true };
}

export async function resyncHolidays(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin");
  const year = Number(formData.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { error: "연도가 올바르지 않습니다" };
  }
  try {
    const count = await syncPublicHolidays(year);
    await db.insert(auditLogs).values({
      actorId: session.user.id,
      actorType: "user",
      action: "holiday.sync",
      targetType: "holiday",
      targetId: String(year),
      detail: { count },
      success: true,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "동기화에 실패했습니다" };
  }
  revalidatePath("/leave");
  return { ok: true };
}
