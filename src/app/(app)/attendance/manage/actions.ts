"use server";

import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { attendanceRecords, auditLogs, leaveRequests, users } from "@/db/schema";
import { assertHr } from "@/lib/auth-helpers";
import type { ActionState } from "@/components/action-form";
import { canEditRecordOf, isHrEditor } from "@/lib/hr";
import { getHolidaySet } from "@/lib/holidays";
import {
  kstDateOf,
  kstToUtc,
  nextKstDate,
  validateAttendanceCorrection,
} from "@/lib/attendance";
import {
  correctLeave,
  countLeaveDays,
  type LeaveSnapshot,
  type LeaveType,
} from "@/lib/leave";

// 인사 정정(R4.4/R3.9) — 타인의 근태·휴가 기록을 사유 필수로 고친다.
// 결재 흐름이 아니라 "기록 정정" 경로다: 상태 상향·approverId 변경·본인 정정은 불가.
//
// 트랜잭션 공통 순서 (design.md):
//   before 스냅샷 읽기 → 순수 함수 검증 → 스냅샷 전체 CAS UPDATE(0행이면 실패)
//   → 잔여 연차 델타(WHERE 안 가드) → tx.insert(auditLogs)
// 락 순서는 항상 leave_requests → users (decideLeave와 동일 — 반대면 데드락).

const LEAVE_TYPES: LeaveType[] = ["annual", "half", "sick"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Session = Awaited<ReturnType<typeof assertHr>>;

function hrActor(session: Session) {
  return { id: session.user.id, hrEditor: isHrEditor(session.user) };
}

function readReason(formData: FormData): string {
  return String(formData.get("reason") ?? "").trim().slice(0, 500);
}

function pgCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e
    ? String((e as { code?: unknown }).code)
    : undefined;
}

function fail(e: unknown): ActionState {
  return { error: e instanceof Error ? e.message : "처리에 실패했습니다" };
}

function revalidateAttendance() {
  revalidatePath("/attendance/manage");
  revalidatePath("/attendance");
  revalidatePath("/");
}

function revalidateLeave() {
  revalidatePath("/attendance/manage");
  revalidatePath("/leave");
  revalidatePath("/leave/team");
  revalidatePath("/org"); // 오늘 휴가 배지 (R8.3)
  revalidatePath("/");
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 감사 로그 — before/after 스냅샷을 같은 트랜잭션 안에서 남긴다 */
async function writeAudit(
  tx: Tx,
  session: Session,
  args: {
    action: string;
    targetType: string;
    targetId: string;
    targetUserId: string;
    reason: string;
    before: unknown;
    after: unknown;
    balanceDelta?: number;
  },
) {
  const target = await tx.query.users.findFirst({
    where: eq(users.id, args.targetUserId),
    columns: { name: true },
  });
  await tx.insert(auditLogs).values({
    actorId: session.user.id,
    actorType: "user",
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    detail: {
      targetUserId: args.targetUserId,
      targetUserName: target?.name ?? null,
      reason: args.reason,
      before: args.before,
      after: args.after,
      ...(args.balanceDelta !== undefined
        ? { balanceDelta: args.balanceDelta }
        : {}),
    },
    success: true,
  });
}

/**
 * 잔여 연차 델타 적용. 양수 = 추가 차감, 음수 = 복원.
 * 가드는 반드시 UPDATE의 WHERE 안에 둔다 — 트랜잭션 안에서 SELECT 후 앱에서 비교하면
 * 행 락이 없어 동시 결재와 TOCTOU가 남는다.
 */
async function applyBalanceDelta(tx: Tx, userId: string, delta: number) {
  if (delta === 0) return;
  // numeric(4,1) 상한 999.9 — 부동소수 오차 없이 정수 산술로 만든다
  const upper = ((9999 + Math.round(delta * 10)) / 10).toFixed(1);
  const guard =
    delta > 0
      ? gte(users.annualLeaveDays, String(delta))
      : lte(users.annualLeaveDays, upper);
  const updated = await tx
    .update(users)
    .set({ annualLeaveDays: sql`${users.annualLeaveDays} - ${delta}` })
    .where(and(eq(users.id, userId), guard))
    .returning({ id: users.id });
  if (updated.length === 0) {
    throw new Error(
      delta > 0
        ? "잔여 연차가 부족해 정정할 수 없습니다"
        : "잔여 연차가 상한(999.9)을 초과합니다",
    );
  }
}

/** 폼의 KST 날짜·시각 → UTC. 익일 퇴근 체크는 근무일 다음 날로 해석한다 */
function readCheckOut(
  formData: FormData,
  baseDate: string,
): Date | null {
  const time = String(formData.get("checkOutTime") ?? "");
  const nextDay = formData.get("checkOutNextDay") != null;
  const dateStr = nextDay ? nextKstDate(baseDate) : baseDate;
  return dateStr ? kstToUtc(dateStr, time) : null;
}

// ── 근태 ────────────────────────────────────────────────────────────────

/** 기존 근태 기록 정정. 열린 기록은 출근 시각을 고정한 채 퇴근만 채운다 */
export async function correctAttendance(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertHr();
  const recordId = String(formData.get("recordId") ?? "");
  const reason = readReason(formData);
  if (!reason) return { error: "정정 사유를 입력하세요" };

  try {
    await db.transaction(async (tx) => {
      const row = await tx.query.attendanceRecords.findFirst({
        where: eq(attendanceRecords.id, recordId),
      });
      if (!row) throw new Error("기록을 찾을 수 없습니다");

      const wasOpen = row.checkOutAt === null;
      // 열린 기록의 출근 시각은 폼 입력을 무시하고 DB 값을 강제한다 —
      // HR이 체크인을 과거로 옮긴 뒤 직원이 퇴근을 누르면 checkOut 액션이
      // 상한 없이 workedMinutes를 계산해 수백 시간이 저장된다
      const checkInAt = wasOpen
        ? row.checkInAt
        : kstToUtc(
            String(formData.get("checkInDate") ?? ""),
            String(formData.get("checkInTime") ?? ""),
          );
      if (!checkInAt) throw new Error("시각 형식이 올바르지 않습니다");

      const baseDate = kstDateOf(checkInAt);
      const checkOutAt = readCheckOut(formData, baseDate);
      if (!checkOutAt) throw new Error("시각 형식이 올바르지 않습니다");

      const v = validateAttendanceCorrection(
        { checkInAt, checkOutAt, targetUserId: row.userId },
        {
          now: new Date(),
          actor: hrActor(session),
          wasOpen,
          lockedCheckInAt: row.checkInAt,
        },
      );
      if (!v.ok) throw new Error(v.reason);

      let updated;
      try {
        updated = await tx
          .update(attendanceRecords)
          .set({
            date: v.date,
            checkInAt,
            checkOutAt,
            workedMinutes: v.workedMinutes,
            note: reason,
          })
          .where(
            and(
              eq(attendanceRecords.id, row.id),
              eq(attendanceRecords.checkInAt, row.checkInAt),
              row.checkOutAt === null
                ? isNull(attendanceRecords.checkOutAt)
                : eq(attendanceRecords.checkOutAt, row.checkOutAt),
            ),
          )
          .returning({ id: attendanceRecords.id });
      } catch (e) {
        // (user_id, date) 유니크 — 근무일이 이동해 기존 행과 겹친 경우
        if (pgCode(e) === "23505") {
          throw new Error("해당 날짜에 이미 근무 기록이 있습니다");
        }
        throw e;
      }
      if (updated.length === 0) {
        throw new Error("다른 사용자가 먼저 변경했습니다");
      }

      await writeAudit(tx, session, {
        action: "attendance.correct",
        targetType: "attendance_record",
        targetId: row.id,
        targetUserId: row.userId,
        reason,
        before: {
          date: row.date,
          checkInAt: row.checkInAt,
          checkOutAt: row.checkOutAt,
          workedMinutes: row.workedMinutes,
          note: row.note,
        },
        after: {
          date: v.date,
          checkInAt,
          checkOutAt,
          workedMinutes: v.workedMinutes,
          note: reason,
        },
      });
    });
  } catch (e) {
    return fail(e);
  }
  revalidateAttendance();
  return { ok: true };
}

/** 누락 근무일 대리 생성 — 퇴근 시각 필수(열린 기록은 만들 수 없다) */
export async function createAttendance(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertHr();
  const targetUserId = String(formData.get("targetUserId") ?? "");
  const reason = readReason(formData);
  if (!reason) return { error: "정정 사유를 입력하세요" };

  const checkInAt = kstToUtc(
    String(formData.get("checkInDate") ?? ""),
    String(formData.get("checkInTime") ?? ""),
  );
  if (!checkInAt) return { error: "시각 형식이 올바르지 않습니다" };
  const checkOutAt = readCheckOut(formData, kstDateOf(checkInAt));
  if (!checkOutAt) return { error: "시각 형식이 올바르지 않습니다" };

  const v = validateAttendanceCorrection(
    { checkInAt, checkOutAt, targetUserId },
    {
      now: new Date(),
      actor: hrActor(session),
      wasOpen: false,
      lockedCheckInAt: null,
    },
  );
  if (!v.ok) return { error: v.reason };

  try {
    await db.transaction(async (tx) => {
      const target = await tx.query.users.findFirst({
        where: eq(users.id, targetUserId),
        columns: { id: true },
      });
      if (!target) throw new Error("대상 직원을 찾을 수 없습니다");

      const inserted = await tx
        .insert(attendanceRecords)
        .values({
          userId: targetUserId,
          date: v.date,
          checkInAt,
          checkOutAt,
          workedMinutes: v.workedMinutes,
          note: reason,
        })
        .onConflictDoNothing()
        .returning({ id: attendanceRecords.id });
      if (inserted.length === 0) {
        throw new Error("해당 날짜에 이미 근무 기록이 있습니다");
      }

      await writeAudit(tx, session, {
        action: "attendance.create",
        targetType: "attendance_record",
        targetId: inserted[0].id,
        targetUserId,
        reason,
        before: null,
        after: {
          date: v.date,
          checkInAt,
          checkOutAt,
          workedMinutes: v.workedMinutes,
          note: reason,
        },
      });
    });
  } catch (e) {
    return fail(e);
  }
  revalidateAttendance();
  return { ok: true };
}

/** 오등록 행 삭제 — 물리 삭제라 감사 로그의 before 스냅샷이 유일한 복구 근거다 */
export async function deleteAttendance(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertHr();
  const recordId = String(formData.get("recordId") ?? "");
  const reason = readReason(formData);
  if (!reason) return { error: "삭제 사유를 입력하세요" };

  try {
    await db.transaction(async (tx) => {
      const row = await tx.query.attendanceRecords.findFirst({
        where: eq(attendanceRecords.id, recordId),
      });
      if (!row) throw new Error("기록을 찾을 수 없습니다");
      // 삭제는 검증할 시각이 없어 순수 함수 대신 권한 판정만 태운다
      if (!canEditRecordOf(session.user, row.userId)) {
        throw new Error(
          isHrEditor(session.user)
            ? "본인 기록은 정정할 수 없습니다"
            : "인사 정정 권한이 없습니다",
        );
      }

      // CAS는 읽은 스냅샷 전체 — checkOutAt을 빼면 직원이 그 사이 퇴근 체크를 해도
      // 삭제가 통과하고, 물리 삭제의 유일한 복구 근거인 before 스냅샷이 낡은 값이 된다
      const deleted = await tx
        .delete(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.id, row.id),
            eq(attendanceRecords.checkInAt, row.checkInAt),
            row.checkOutAt === null
              ? isNull(attendanceRecords.checkOutAt)
              : eq(attendanceRecords.checkOutAt, row.checkOutAt),
          ),
        )
        .returning({ id: attendanceRecords.id });
      if (deleted.length === 0) {
        throw new Error("다른 사용자가 먼저 변경했습니다");
      }

      await writeAudit(tx, session, {
        action: "attendance.delete",
        targetType: "attendance_record",
        targetId: row.id,
        targetUserId: row.userId,
        reason,
        before: {
          date: row.date,
          checkInAt: row.checkInAt,
          checkOutAt: row.checkOutAt,
          workedMinutes: row.workedMinutes,
          note: row.note,
        },
        after: null,
      });
    });
  } catch (e) {
    return fail(e);
  }
  revalidateAttendance();
  return { ok: true };
}

// ── 휴가 ────────────────────────────────────────────────────────────────

/** 활성 휴가 신청의 유형·기간 정정. 일수는 서버가 재계산하고 폼 입력을 신뢰하지 않는다 */
export async function correctLeaveRequest(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertHr();
  const requestId = String(formData.get("requestId") ?? "");
  const reason = readReason(formData);
  if (!reason) return { error: "정정 사유를 입력하세요" };

  const type = String(formData.get("type") ?? "") as LeaveType;
  const startDate = String(formData.get("startDate") ?? "");
  const endRaw = String(formData.get("endDate") ?? "");
  // 반차는 하루짜리 — createLeave와 동일 정규화
  const endDate = type === "half" || !endRaw ? startDate : endRaw;
  // 날짜 형식을 여기서 막지 않으면 getHolidaySet의 date 비교에서 Postgres 원문 오류가
  // 그대로 사용자에게 노출된다 (createLeave와 동일 검증)
  if (
    !LEAVE_TYPES.includes(type) ||
    !DATE_RE.test(startDate) ||
    !DATE_RE.test(endDate)
  ) {
    return { error: "입력이 올바르지 않습니다" };
  }

  try {
    await db.transaction(async (tx) => {
      const req = await tx.query.leaveRequests.findFirst({
        where: eq(leaveRequests.id, requestId),
      });
      if (!req) throw new Error("신청을 찾을 수 없습니다");

      // R3.6/R3.7 우회 방지 — 일수는 항상 서버가 휴일 집합으로 재계산한다
      const holidaySet = await getHolidaySet(startDate, endDate);
      const days = countLeaveDays(type, startDate, endDate, holidaySet);

      const before: LeaveSnapshot = {
        userId: req.userId,
        type: req.type,
        status: req.status,
        startDate: req.startDate,
        endDate: req.endDate,
        days: Number(req.days),
        approverId: req.approverId,
      };
      const result = correctLeave(
        before,
        { type, startDate, endDate, days, cancel: false },
        hrActor(session),
      );
      if (!result.ok) throw new Error(result.reason);

      let updated;
      try {
        updated = await tx
          .update(leaveRequests)
          // status·approverId·reason·decidedAt은 건드리지 않는다 (결재 이력 보존)
          .set({ type, startDate, endDate, days: String(days) })
          .where(
            and(
              eq(leaveRequests.id, requestId),
              eq(leaveRequests.status, req.status),
              eq(leaveRequests.type, req.type),
              // numeric은 드라이버가 문자열로 준다 — 변환 없이 원본 그대로 비교
              eq(leaveRequests.days, req.days),
              eq(leaveRequests.startDate, req.startDate),
              eq(leaveRequests.endDate, req.endDate),
            ),
          )
          .returning({ id: leaveRequests.id });
      } catch (e) {
        // EXCLUDE 제약(leave_requests_no_overlap)
        if (pgCode(e) === "23P01") {
          throw new Error("해당 기간과 겹치는 신청이 이미 있습니다");
        }
        throw e;
      }
      if (updated.length === 0) {
        throw new Error(
          "신청 내용이 변경되었습니다. 새로고침 후 다시 시도하세요",
        );
      }

      await applyBalanceDelta(tx, before.userId, result.balanceDelta);

      await writeAudit(tx, session, {
        action: "leave.correct",
        targetType: "leave_request",
        targetId: requestId,
        targetUserId: before.userId,
        reason,
        before,
        after: result.after,
        balanceDelta: result.balanceDelta,
      });
    });
  } catch (e) {
    return fail(e);
  }
  revalidateLeave();
  return { ok: true };
}

/** 활성 휴가의 인사 취소 — 승인 건이면 잔여 연차가 복원된다 */
export async function forceCancelLeave(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertHr();
  const requestId = String(formData.get("requestId") ?? "");
  const reason = readReason(formData);
  if (!reason) return { error: "취소 사유를 입력하세요" };

  try {
    await db.transaction(async (tx) => {
      const req = await tx.query.leaveRequests.findFirst({
        where: eq(leaveRequests.id, requestId),
      });
      if (!req) throw new Error("신청을 찾을 수 없습니다");

      const before: LeaveSnapshot = {
        userId: req.userId,
        type: req.type,
        status: req.status,
        startDate: req.startDate,
        endDate: req.endDate,
        days: Number(req.days),
        approverId: req.approverId,
      };
      const result = correctLeave(
        before,
        {
          type: before.type,
          startDate: before.startDate,
          endDate: before.endDate,
          days: before.days,
          cancel: true,
        },
        hrActor(session),
      );
      if (!result.ok) throw new Error(result.reason);

      const updated = await tx
        .update(leaveRequests)
        .set({ status: "cancelled", decidedAt: new Date() })
        .where(
          and(
            eq(leaveRequests.id, requestId),
            eq(leaveRequests.status, req.status),
            eq(leaveRequests.type, req.type),
            eq(leaveRequests.days, req.days),
            eq(leaveRequests.startDate, req.startDate),
            eq(leaveRequests.endDate, req.endDate),
          ),
        )
        .returning({ id: leaveRequests.id });
      if (updated.length === 0) {
        throw new Error(
          "신청 내용이 변경되었습니다. 새로고침 후 다시 시도하세요",
        );
      }

      await applyBalanceDelta(tx, before.userId, result.balanceDelta);

      await writeAudit(tx, session, {
        action: "leave.force_cancel",
        targetType: "leave_request",
        targetId: requestId,
        targetUserId: before.userId,
        reason,
        before,
        after: result.after,
        balanceDelta: result.balanceDelta,
      });
    });
  } catch (e) {
    return fail(e);
  }
  revalidateLeave();
  return { ok: true };
}
