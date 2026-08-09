import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  eventBlock,
  mondayOf,
  weekdaysOf,
  weekRangeLabel,
} from "./calendar-week";

describe("addDaysIso", () => {
  it("월 경계를 넘는다", () => {
    expect(addDaysIso("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysIso("2026-09-01", -1)).toBe("2026-08-31");
  });
  it("연 경계를 넘는다", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("mondayOf", () => {
  it("주중은 그 주 월요일", () => {
    expect(mondayOf("2026-08-13")).toBe("2026-08-10"); // 목
    expect(mondayOf("2026-08-10")).toBe("2026-08-10"); // 월
  });
  it("일요일은 지난 월요일", () => {
    expect(mondayOf("2026-08-09")).toBe("2026-08-03");
  });
  it("토요일은 그 주 월요일", () => {
    expect(mondayOf("2026-08-08")).toBe("2026-08-03");
  });
});

describe("weekdaysOf", () => {
  it("월~금 5일", () => {
    expect(weekdaysOf("2026-08-10")).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
    ]);
  });
});

describe("weekRangeLabel", () => {
  it("같은 달", () => {
    expect(weekRangeLabel("2026-08-10")).toBe("2026년 8월 10일 – 14일");
  });
  it("월 경계", () => {
    expect(weekRangeLabel("2026-08-31")).toBe("2026년 8월 31일 – 9월 4일");
  });
  it("연 경계", () => {
    expect(weekRangeLabel("2026-12-28")).toBe("2026년 12월 28일 – 2027년 1월 1일");
  });
});

describe("eventBlock", () => {
  const day = "2026-08-10";
  it("정상 배치 — 09:30~10:30은 top 72, height 46", () => {
    expect(
      eventBlock("2026-08-10T09:30:00", "2026-08-10T10:30:00", day),
    ).toEqual({ top: 72, height: 46 });
  });
  it("08시 이전 시작은 창 시작으로 클램프", () => {
    expect(
      eventBlock("2026-08-10T07:00:00", "2026-08-10T09:00:00", day),
    ).toEqual({ top: 0, height: 46 });
  });
  it("창 밖(새벽) 이벤트는 null", () => {
    expect(
      eventBlock("2026-08-10T06:00:00", "2026-08-10T07:30:00", day),
    ).toBeNull();
  });
  it("19시 이후 시작은 null", () => {
    expect(
      eventBlock("2026-08-10T19:00:00", "2026-08-10T20:00:00", day),
    ).toBeNull();
  });
  it("다른 날 시작 이벤트는 이 컬럼에 없음", () => {
    expect(
      eventBlock("2026-08-11T09:00:00", "2026-08-11T10:00:00", day),
    ).toBeNull();
  });
  it("자정 넘김 이벤트는 창 끝까지", () => {
    expect(
      eventBlock("2026-08-10T17:00:00", "2026-08-11T01:00:00", day),
    ).toEqual({ top: 432, height: 94 });
  });
  it("짧은 이벤트도 최소 높이 18", () => {
    expect(
      eventBlock("2026-08-10T09:00:00", "2026-08-10T09:10:00", day),
    ).toEqual({ top: 48, height: 18 });
  });
});
