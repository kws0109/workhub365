"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { attendanceRecords } from "@/db/schema";
import { assertRole } from "@/lib/auth-helpers";
import type { ActionState } from "@/components/action-form";
import { kstDateOf, workedMinutesBetween } from "@/lib/attendance";

export async function checkIn(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin", "manager", "employee");
  const now = new Date();

  // 전날 미퇴근 기록이 열려 있으면 먼저 닫도록 안내 — 이중 근무일 방지
  const open = await db.query.attendanceRecords.findFirst({
    where: and(
      eq(attendanceRecords.userId, session.user.id),
      isNull(attendanceRecords.checkOutAt),
    ),
  });
  if (open) {
    return {
      error: `${open.date} 근무가 퇴근 처리되지 않았습니다. 먼저 퇴근 체크하세요`,
    };
  }

  // (user_id, date) 유니크 — 더블클릭·중복 출근은 DB가 차단
  const inserted = await db
    .insert(attendanceRecords)
    .values({
      userId: session.user.id,
      date: kstDateOf(now),
      checkInAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: attendanceRecords.id });

  if (inserted.length === 0) {
    return { error: "오늘은 이미 출근 체크되었습니다" };
  }
  revalidatePath("/attendance");
  revalidatePath("/"); // 홈 대시보드 근무 카드 (R7.4)
  return { ok: true };
}

export async function checkOut(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin", "manager", "employee");
  const now = new Date();

  // 오늘 날짜가 아니라 "가장 최근의 열린 기록"을 닫는다 —
  // KST 자정을 넘긴 근무(체크인 날짜 귀속 정책)도 퇴근 처리 가능해야 한다
  const open = await db.query.attendanceRecords.findFirst({
    where: and(
      eq(attendanceRecords.userId, session.user.id),
      isNull(attendanceRecords.checkOutAt),
    ),
    orderBy: desc(attendanceRecords.date),
  });
  if (!open) return { error: "퇴근 처리할 출근 기록이 없습니다" };

  const updated = await db
    .update(attendanceRecords)
    .set({
      checkOutAt: now,
      workedMinutes: workedMinutesBetween(open.checkInAt, now),
    })
    .where(
      and(eq(attendanceRecords.id, open.id), isNull(attendanceRecords.checkOutAt)),
    )
    .returning({ id: attendanceRecords.id });
  if (updated.length === 0) {
    return { error: "이미 퇴근 처리되었습니다" };
  }
  revalidatePath("/attendance");
  revalidatePath("/"); // 홈 대시보드 근무 카드 (R7.4)
  return { ok: true };
}
