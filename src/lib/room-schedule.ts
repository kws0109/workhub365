// 회의실 예약(B6, R8.6)의 가용성·시간 순수 로직 — UI와 분리해 단위 테스트를 붙인다.
// 날짜는 KST "YYYY-MM-DD", datetime은 Graph Prefer 헤더 기준 KST "YYYY-MM-DDTHH:mm:ss…" 문자열

export const ROOM_START_HOUR = 9;
export const ROOM_END_HOUR = 17;
/** 09~17시 1시간 단위 = 8칸 */
export const ROOM_SLOT_COUNT = ROOM_END_HOUR - ROOM_START_HOUR;

export type RoomSlot = "free" | "busy" | "mine";

/**
 * getSchedule availabilityView 문자열 → 슬롯 상태 8칸.
 * '0'=free, 그 외('1' 잠정 ~ '4' 근무지 외)는 busy. 결측(짧은 문자열·조회 실패)도
 * 보수적으로 busy — 확인 안 된 시간대에 예약을 걸지 않게 한다. 초과분은 잘라낸다.
 */
export function slotsFromView(view: string | undefined): RoomSlot[] {
  return Array.from({ length: ROOM_SLOT_COUNT }, (_, i) =>
    view?.[i] === "0" ? "free" : "busy",
  );
}

/**
 * 내 이벤트(KST datetime) → dateKst 그리드의 슬롯 인덱스 범위 [start, end).
 * 부분 시간은 슬롯 경계로 확장(14:30 시작도 14시 슬롯 점유), 창 밖·다른 날짜는 null.
 * 자정을 넘겨 끝나는 이벤트는 창 끝까지로 본다.
 */
export function eventSlotRange(
  startDateTime: string,
  endDateTime: string,
  dateKst: string,
): { start: number; end: number } | null {
  if (!startDateTime.startsWith(dateKst)) return null;
  const toHours = (s: string) =>
    Number(s.slice(11, 13)) + Number(s.slice(14, 16)) / 60;
  const start = toHours(startDateTime);
  const end = endDateTime.startsWith(dateKst) ? toHours(endDateTime) : ROOM_END_HOUR;
  const startIdx = Math.max(0, Math.floor(start - ROOM_START_HOUR));
  const endIdx = Math.min(ROOM_SLOT_COUNT, Math.ceil(end - ROOM_START_HOUR));
  return endIdx <= startIdx ? null : { start: startIdx, end: endIdx };
}

/** 기본 슬롯 배열 위에 내 예약 범위를 mine으로 덧씌운다 (원본 불변) */
export function overlayMine(
  slots: RoomSlot[],
  ranges: { start: number; end: number }[],
): RoomSlot[] {
  const out = [...slots];
  for (const r of ranges) {
    for (let i = Math.max(0, r.start); i < Math.min(out.length, r.end); i++) {
      out[i] = "mine";
    }
  }
  return out;
}

/** 연속한 busy/mine 슬롯을 블록으로 병합 — 그리드 col-span 배치용. free는 제외 */
export function mergeBlocks(
  slots: RoomSlot[],
): { start: number; span: number; status: "busy" | "mine" }[] {
  const blocks: { start: number; span: number; status: "busy" | "mine" }[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s === "free") continue;
    const last = blocks[blocks.length - 1];
    if (last && last.status === s && last.start + last.span === i) {
      last.span++;
    } else {
      blocks.push({ start: i, span: 1, status: s });
    }
  }
  return blocks;
}

/** 예약 가능 판정 — 정수 시간, 1~2시간, 09~17시 창 안, 요청 구간 전부 free */
export function canBook(
  slots: RoomSlot[],
  startHour: number,
  durationHours: number,
): boolean {
  if (!Number.isInteger(startHour) || !Number.isInteger(durationHours)) return false;
  if (durationHours < 1 || durationHours > 2) return false;
  if (startHour < ROOM_START_HOUR || startHour + durationHours > ROOM_END_HOUR) {
    return false;
  }
  const from = startHour - ROOM_START_HOUR;
  return slots.slice(from, from + durationHours).every((s) => s === "free");
}

/** KST 날짜의 h시(0~, 24 이상 허용 — 다음 날로 넘어간다) → UTC ISO. calendarView 쿼리용 */
export function kstHourToUtcIso(dateKst: string, hour: number): string {
  return new Date(
    new Date(`${dateKst}T00:00:00+09:00`).getTime() + hour * 3_600_000,
  ).toISOString();
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "2026-08-13" → "2026-08-13 (목)" */
export function roomDayLabel(dateKst: string): string {
  // 달력에 없는 날짜가 흘러오면 getUTCDay()가 NaN이라 인덱싱이 undefined다 —
  // "(undefined)"가 화면에 찍히는 대신 "(?)"로 떨어뜨린다
  const dow = new Date(`${dateKst}T00:00:00Z`).getUTCDay();
  return `${dateKst} (${WEEKDAY_KO[dow] ?? "?"})`;
}

/** 내 예약 행의 시간 라벨 — "8/13 14:00–15:30" */
export function eventTimeLabel(startDateTime: string, endDateTime: string): string {
  const md = `${Number(startDateTime.slice(5, 7))}/${Number(startDateTime.slice(8, 10))}`;
  return `${md} ${startDateTime.slice(11, 16)}–${endDateTime.slice(11, 16)}`;
}
