import { describe, expect, it } from "vitest";
import { isCalendarDate, isCalendarMonth } from "./date-param";

describe("isCalendarDate", () => {
  it("실재하는 날짜는 통과", () => {
    expect(isCalendarDate("2026-08-09")).toBe(true);
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true); // 윤년
    expect(isCalendarDate("2026-12-31")).toBe(true);
  });
  it("형식은 맞지만 달력에 없는 값은 차단", () => {
    expect(isCalendarDate("2026-13-45")).toBe(false);
    expect(isCalendarDate("2026-00-10")).toBe(false);
    expect(isCalendarDate("2026-02-31")).toBe(false); // 롤오버(3/3)라 라운드트립에서 걸린다
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2025-02-29")).toBe(false); // 평년
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("0000-00-00")).toBe(false);
    expect(isCalendarDate("2026-08-00")).toBe(false);
    expect(isCalendarDate("2026-08-32")).toBe(false);
  });
  it("형식 자체가 틀리면 차단", () => {
    expect(isCalendarDate("2026-8-9")).toBe(false);
    expect(isCalendarDate("2026-08-09T00:00:00Z")).toBe(false);
    expect(isCalendarDate("2026-08")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
    expect(isCalendarDate(undefined)).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
  });
});

describe("isCalendarMonth", () => {
  it("실재하는 월은 통과", () => {
    expect(isCalendarMonth("2026-01")).toBe(true);
    expect(isCalendarMonth("2026-08")).toBe(true);
    expect(isCalendarMonth("2026-12")).toBe(true);
    expect(isCalendarMonth("2000-01")).toBe(true); // 하한 경계
    expect(isCalendarMonth("2100-12")).toBe(true); // 상한 경계
  });
  it("월 범위를 벗어나면 차단", () => {
    expect(isCalendarMonth("2026-00")).toBe(false);
    expect(isCalendarMonth("2026-13")).toBe(false);
    expect(isCalendarMonth("9999-99")).toBe(false);
  });
  it("연도 범위(2000~2100)를 벗어나면 차단", () => {
    expect(isCalendarMonth("1999-01")).toBe(false);
    expect(isCalendarMonth("2101-01")).toBe(false);
    expect(isCalendarMonth("0000-01")).toBe(false);
    expect(isCalendarMonth("9999-12")).toBe(false);
  });
  it("형식 자체가 틀리면 차단", () => {
    expect(isCalendarMonth("2026-8")).toBe(false);
    expect(isCalendarMonth("2026-08-09")).toBe(false);
    expect(isCalendarMonth("")).toBe(false);
    expect(isCalendarMonth(undefined)).toBe(false);
    expect(isCalendarMonth(null)).toBe(false);
  });
});
