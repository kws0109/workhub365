"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { assertRole } from "@/lib/auth-helpers";
import type { ActionState } from "@/components/action-form";
import { GraphError } from "@/lib/graph/client";
import { getDelegatedGraphToken } from "@/lib/graph/delegated";
import {
  cancelEvent,
  createRoomEvent,
  getRooms,
  getRoomSchedules,
  type RoomInfo,
} from "@/lib/graph/rooms";
import {
  canBook,
  ROOM_END_HOUR,
  ROOM_START_HOUR,
  slotsFromView,
} from "@/lib/room-schedule";

// 회의실 예약(B6) 서버 액션 — 개인 일정 쓰기(위임)라 승인 게이트 대상은 아니지만
// (관리 액션이 아님, 아키텍처 규칙 3 무관) 쓰기이므로 감사 로그는 남긴다(규칙 4 준용).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RELOGIN_ERROR =
  "Microsoft 일정 권한이 필요합니다 — 다시 로그인해 동의해 주세요";

async function auditRoom(
  actorId: string,
  action: "room.book" | "room.cancel",
  targetId: string,
  detail: Record<string, unknown>,
  success: boolean,
): Promise<void> {
  await db.insert(auditLogs).values({
    actorId,
    actorType: "user",
    action,
    targetType: "room_event",
    targetId,
    detail,
    success,
  });
}

export async function bookRoom(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin", "manager", "employee");

  const roomEmail = String(formData.get("roomEmail") ?? "").trim().toLowerCase();
  const dateKst = String(formData.get("dateKst") ?? "");
  const startHour = Number(formData.get("startHour"));
  const durationHours = Number(formData.get("durationHours") ?? 1);
  const subject = String(formData.get("subject") ?? "").trim().slice(0, 200);

  if (!roomEmail || !DATE_RE.test(dateKst) || !subject) {
    return { error: "입력이 올바르지 않습니다" };
  }
  if (
    !Number.isInteger(startHour) ||
    !Number.isInteger(durationHours) ||
    durationHours < 1 ||
    durationHours > 2 ||
    startHour < ROOM_START_HOUR ||
    startHour + durationHours > ROOM_END_HOUR
  ) {
    return { error: "예약 시간이 올바르지 않습니다 (09~17시 · 1~2시간)" };
  }

  // 폼 값을 신뢰하지 않는다 — 회의실은 서버의 리소스 사서함 목록에서 재확인
  // (임의 주소를 resource 참석자로 초대하는 것을 차단)
  let room: RoomInfo | undefined;
  try {
    room = (await getRooms()).find(
      (r) => r.emailAddress.toLowerCase() === roomEmail,
    );
  } catch {
    return { error: "회의실 목록 조회에 실패했습니다 — 잠시 후 다시 시도하세요" };
  }
  if (!room) return { error: "회의실을 찾을 수 없습니다" };

  const token = await getDelegatedGraphToken();
  if (!token) return { error: RELOGIN_ERROR };

  try {
    // 생성 직전 가용성 재확인 — 그리드 렌더 이후 생긴 충돌을 줄인다.
    // 완전한 보장은 아니며(경합 창 존재) 최종 판정은 리소스 사서함의 수락/거절이 한다
    const schedules = await getRoomSchedules(token, [room.emailAddress], dateKst);
    const slots = slotsFromView(schedules.get(room.emailAddress.toLowerCase()));
    if (!canBook(slots, startHour, durationHours)) {
      return { error: "이미 예약된 시간대입니다 — 다른 시간을 선택하세요" };
    }

    const created = await createRoomEvent(token, {
      roomEmail: room.emailAddress,
      roomName: room.displayName,
      dateKst,
      startHour,
      durationHours,
      subject,
    });
    await auditRoom(
      session.user.id,
      "room.book",
      room.emailAddress,
      {
        eventId: created.id,
        roomName: room.displayName,
        dateKst,
        startHour,
        durationHours,
        subject,
      },
      true,
    );
  } catch (e) {
    await auditRoom(
      session.user.id,
      "room.book",
      room.emailAddress,
      {
        roomName: room.displayName,
        dateKst,
        startHour,
        durationHours,
        subject,
        error: e instanceof Error ? e.message : String(e),
      },
      false,
    );
    if (e instanceof GraphError) {
      return {
        error:
          e.status === 403 ? RELOGIN_ERROR : `예약에 실패했습니다: ${e.message}`,
      };
    }
    return { error: "예약에 실패했습니다 — 잠시 후 다시 시도하세요" };
  }

  revalidatePath("/rooms");
  // 성공 시 인라인 예약 폼(?book=…)을 닫는다
  redirect(`/rooms?date=${dateKst}`);
}

export async function cancelRoomBooking(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin", "manager", "employee");

  const eventId = String(formData.get("eventId") ?? "").trim();
  // 감사 로그 가독용 표시 라벨 — 위조돼도 삭제 대상은 eventId(본인 캘린더 한정)뿐
  const label = String(formData.get("label") ?? "").slice(0, 200);
  if (!eventId) return { error: "입력이 올바르지 않습니다" };

  const token = await getDelegatedGraphToken();
  if (!token) return { error: RELOGIN_ERROR };

  try {
    // /me/events 삭제라 본인 캘린더의 이벤트만 지울 수 있다 (타인 예약 취소 불가)
    await cancelEvent(token, eventId);
    await auditRoom(session.user.id, "room.cancel", eventId, { label }, true);
  } catch (e) {
    await auditRoom(
      session.user.id,
      "room.cancel",
      eventId,
      { label, error: e instanceof Error ? e.message : String(e) },
      false,
    );
    if (e instanceof GraphError) {
      return {
        error:
          e.status === 403 ? RELOGIN_ERROR : `취소에 실패했습니다: ${e.message}`,
      };
    }
    return { error: "취소에 실패했습니다 — 잠시 후 다시 시도하세요" };
  }

  revalidatePath("/rooms");
  return { ok: true };
}
