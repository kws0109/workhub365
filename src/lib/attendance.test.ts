import { describe, expect, it } from "vitest";
import {
  aggregateWeeklyMinutes,
  isInWeek,
  kstDateOf,
  overtimeLevel,
  weekStartKst,
  workedMinutesBetween,
} from "./attendance";

describe("kstDateOf", () => {
  it("UTC 저녁은 KST 다음날", () => {
    // UTC 2026-08-07 16:00 = KST 2026-08-08 01:00
    expect(kstDateOf(new Date("2026-08-07T16:00:00Z"))).toBe("2026-08-08");
  });

  it("UTC 오전은 KST 같은 날", () => {
    expect(kstDateOf(new Date("2026-08-07T03:00:00Z"))).toBe("2026-08-07");
  });
});

describe("weekStartKst", () => {
  it("금요일 → 그 주 월요일", () => {
    // 2026-08-07은 금요일 (KST)
    expect(weekStartKst(new Date("2026-08-07T03:00:00Z"))).toBe("2026-08-03");
  });

  it("KST 월요일 자정 직후 = 그날이 주 시작 (UTC로는 일요일 저녁)", () => {
    // UTC 2026-08-09(일) 15:30 = KST 2026-08-10(월) 00:30
    expect(weekStartKst(new Date("2026-08-09T15:30:00Z"))).toBe("2026-08-10");
  });

  it("KST 일요일 밤 = 아직 이전 주", () => {
    // UTC 2026-08-09(일) 14:00 = KST 2026-08-09(일) 23:00
    expect(weekStartKst(new Date("2026-08-09T14:00:00Z"))).toBe("2026-08-03");
  });
});

describe("isInWeek", () => {
  it("월요일 포함, 다음 월요일 제외", () => {
    expect(isInWeek("2026-08-03", "2026-08-03")).toBe(true);
    expect(isInWeek("2026-08-09", "2026-08-03")).toBe(true);
    expect(isInWeek("2026-08-10", "2026-08-03")).toBe(false);
    expect(isInWeek("2026-08-02", "2026-08-03")).toBe(false);
  });
});

describe("aggregateWeeklyMinutes", () => {
  const week = "2026-08-03";

  it("주 내 확정 기록만 합산 — 미퇴근(null)은 제외", () => {
    const total = aggregateWeeklyMinutes(
      [
        { date: "2026-08-03", workedMinutes: 480 },
        { date: "2026-08-04", workedMinutes: 600 },
        { date: "2026-08-05", workedMinutes: null }, // 미퇴근
        { date: "2026-08-10", workedMinutes: 480 }, // 다음 주
      ],
      week,
    );
    expect(total).toBe(1080);
  });
});

describe("overtimeLevel", () => {
  it("48h 미만 ok / 48h 이상 warn / 52h 이상 over (경계 포함)", () => {
    expect(overtimeLevel(48 * 60 - 1)).toBe("ok");
    expect(overtimeLevel(48 * 60)).toBe("warn");
    expect(overtimeLevel(52 * 60 - 1)).toBe("warn");
    expect(overtimeLevel(52 * 60)).toBe("over");
  });
});

describe("workedMinutesBetween", () => {
  it("자정 넘김 근무도 단순 차이로 계산", () => {
    expect(
      workedMinutesBetween(
        new Date("2026-08-07T13:00:00Z"), // KST 22:00
        new Date("2026-08-07T17:30:00Z"), // KST 다음날 02:30
      ),
    ).toBe(270);
  });

  it("역전 시각은 0", () => {
    expect(
      workedMinutesBetween(
        new Date("2026-08-07T10:00:00Z"),
        new Date("2026-08-07T09:00:00Z"),
      ),
    ).toBe(0);
  });
});
