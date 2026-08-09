import { describe, expect, it } from "vitest";
import {
  canBook,
  eventSlotRange,
  eventTimeLabel,
  kstHourToUtcIso,
  mergeBlocks,
  overlayMine,
  roomDayLabel,
  ROOM_SLOT_COUNT,
  slotsFromView,
  type RoomSlot,
} from "./room-schedule";

describe("slotsFromView", () => {
  it("'0'만 free, 그 외 문자는 busy", () => {
    expect(slotsFromView("00220000")).toEqual([
      "free",
      "free",
      "busy",
      "busy",
      "free",
      "free",
      "free",
      "free",
    ]);
    expect(slotsFromView("13024000")[0]).toBe("busy"); // 잠정(1)도 busy
    expect(slotsFromView("13024000")[3]).toBe("busy"); // OOF(3)·근무지 외(4)도 busy
  });
  it("8칸 초과 문자열은 잘라낸다", () => {
    expect(slotsFromView("0022000000")).toHaveLength(ROOM_SLOT_COUNT);
  });
  it("짧은 문자열·결측은 보수적으로 busy", () => {
    expect(slotsFromView("00")).toEqual([
      "free",
      "free",
      "busy",
      "busy",
      "busy",
      "busy",
      "busy",
      "busy",
    ]);
    expect(slotsFromView(undefined)).toEqual(Array(8).fill("busy"));
  });
});

describe("eventSlotRange", () => {
  const day = "2026-08-13";
  it("14:00–15:30 → 슬롯 5~7 (부분 시간은 경계로 확장)", () => {
    expect(
      eventSlotRange(`${day}T14:00:00.0000000`, `${day}T15:30:00.0000000`, day),
    ).toEqual({ start: 5, end: 7 });
  });
  it("정시 1시간 — 09:00–10:00 → 슬롯 0~1", () => {
    expect(eventSlotRange(`${day}T09:00:00`, `${day}T10:00:00`, day)).toEqual({
      start: 0,
      end: 1,
    });
  });
  it("다른 날짜 이벤트는 null", () => {
    expect(
      eventSlotRange("2026-08-14T10:00:00", "2026-08-14T11:00:00", day),
    ).toBeNull();
  });
  it("창 앞(07–08시)·창 뒤(17–18시)는 null", () => {
    expect(eventSlotRange(`${day}T07:00:00`, `${day}T08:00:00`, day)).toBeNull();
    expect(eventSlotRange(`${day}T17:00:00`, `${day}T18:00:00`, day)).toBeNull();
  });
  it("창을 걸치면 창 안으로 클램프", () => {
    expect(eventSlotRange(`${day}T08:00:00`, `${day}T10:00:00`, day)).toEqual({
      start: 0,
      end: 1,
    });
    expect(eventSlotRange(`${day}T16:30:00`, `${day}T18:00:00`, day)).toEqual({
      start: 7,
      end: 8,
    });
  });
  it("자정을 넘겨 끝나면 창 끝까지", () => {
    expect(eventSlotRange(`${day}T16:00:00`, "2026-08-14T01:00:00", day)).toEqual({
      start: 7,
      end: 8,
    });
  });
});

describe("overlayMine", () => {
  it("범위를 mine으로 덧씌우고 원본은 보존한다", () => {
    const base = slotsFromView("00220000");
    const out = overlayMine(base, [{ start: 2, end: 4 }]);
    expect(out[2]).toBe("mine");
    expect(out[3]).toBe("mine");
    expect(out[0]).toBe("free");
    expect(base[2]).toBe("busy"); // 원본 불변
  });
  it("배열 경계를 벗어난 범위는 잘라낸다", () => {
    const out = overlayMine(slotsFromView("00000000"), [{ start: 6, end: 12 }]);
    expect(out[6]).toBe("mine");
    expect(out[7]).toBe("mine");
    expect(out).toHaveLength(8);
  });
});

describe("mergeBlocks", () => {
  it("연속한 같은 상태를 병합한다", () => {
    const slots: RoomSlot[] = [
      "free",
      "busy",
      "busy",
      "free",
      "mine",
      "mine",
      "busy",
      "free",
    ];
    expect(mergeBlocks(slots)).toEqual([
      { start: 1, span: 2, status: "busy" },
      { start: 4, span: 2, status: "mine" },
      { start: 6, span: 1, status: "busy" },
    ]);
  });
  it("busy와 mine이 인접해도 병합하지 않는다", () => {
    const slots: RoomSlot[] = [
      "busy",
      "mine",
      "free",
      "free",
      "free",
      "free",
      "free",
      "free",
    ];
    expect(mergeBlocks(slots)).toEqual([
      { start: 0, span: 1, status: "busy" },
      { start: 1, span: 1, status: "mine" },
    ]);
  });
  it("전부 free면 빈 배열", () => {
    expect(mergeBlocks(slotsFromView("00000000"))).toEqual([]);
  });
});

describe("canBook", () => {
  const slots = slotsFromView("00220000"); // 11~12시(인덱스 2~3)만 busy
  it("빈 구간은 예약 가능", () => {
    expect(canBook(slots, 9, 1)).toBe(true);
    expect(canBook(slots, 9, 2)).toBe(true);
    expect(canBook(slots, 13, 2)).toBe(true);
  });
  it("busy와 겹치면 불가", () => {
    expect(canBook(slots, 11, 1)).toBe(false);
    expect(canBook(slots, 10, 2)).toBe(false); // 10~12시 — 뒤 절반이 busy
  });
  it("mine과 겹쳐도 불가", () => {
    const withMine = overlayMine(slotsFromView("00000000"), [{ start: 0, end: 1 }]);
    expect(canBook(withMine, 9, 1)).toBe(false);
  });
  it("09~17시 창 밖은 불가", () => {
    expect(canBook(slots, 8, 1)).toBe(false);
    expect(canBook(slots, 17, 1)).toBe(false);
    expect(canBook(slots, 16, 2)).toBe(false); // 18시 종료 — 창 초과
    expect(canBook(slots, 16, 1)).toBe(true);
  });
  it("정수가 아니거나 1~2시간 밖이면 불가", () => {
    expect(canBook(slots, 9.5, 1)).toBe(false);
    expect(canBook(slots, 9, 0)).toBe(false);
    expect(canBook(slots, 9, 3)).toBe(false);
  });
});

describe("kstHourToUtcIso", () => {
  it("KST 09시 = UTC 00시", () => {
    expect(kstHourToUtcIso("2026-08-13", 9)).toBe("2026-08-13T00:00:00.000Z");
  });
  it("KST 00시 = 전날 UTC 15시", () => {
    expect(kstHourToUtcIso("2026-08-13", 0)).toBe("2026-08-12T15:00:00.000Z");
  });
  it("24시간 이상은 다음 날로 넘어간다 (주간 범위 계산)", () => {
    expect(kstHourToUtcIso("2026-08-13", 24 * 7)).toBe("2026-08-19T15:00:00.000Z");
  });
});

describe("roomDayLabel", () => {
  it("요일을 붙인다", () => {
    expect(roomDayLabel("2026-08-13")).toBe("2026-08-13 (목)");
    expect(roomDayLabel("2026-08-09")).toBe("2026-08-09 (일)");
  });
});

describe("eventTimeLabel", () => {
  it("월/일 시각 범위 라벨", () => {
    expect(
      eventTimeLabel("2026-08-13T14:00:00.0000000", "2026-08-13T15:30:00.0000000"),
    ).toBe("8/13 14:00–15:30");
  });
});
