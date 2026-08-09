import { describe, expect, it } from "vitest";
import { isPostCategory, weekStartUtc } from "./board";

describe("weekStartUtc", () => {
  it("금요일(KST) → 그 주 월요일 00:00 KST = 일요일 15:00 UTC", () => {
    // 2026-08-07은 금요일 (KST). 주 시작 = 2026-08-03(월) 00:00 KST
    expect(weekStartUtc(new Date("2026-08-07T03:00:00Z")).toISOString()).toBe(
      "2026-08-02T15:00:00.000Z",
    );
  });

  it("KST 월요일 자정 직후 = 그 시각이 새 주의 시작", () => {
    // UTC 2026-08-09(일) 15:30 = KST 2026-08-10(월) 00:30
    expect(weekStartUtc(new Date("2026-08-09T15:30:00Z")).toISOString()).toBe(
      "2026-08-09T15:00:00.000Z",
    );
  });

  it("KST 일요일 밤 = 아직 이전 주", () => {
    // UTC 2026-08-09(일) 14:00 = KST 2026-08-09(일) 23:00
    expect(weekStartUtc(new Date("2026-08-09T14:00:00Z")).toISOString()).toBe(
      "2026-08-02T15:00:00.000Z",
    );
  });
});

describe("isPostCategory", () => {
  it("정의된 카테고리만 통과", () => {
    expect(isPostCategory("notice")).toBe(true);
    expect(isPostCategory("hr")).toBe(true);
    expect(isPostCategory("general_affairs")).toBe(true);
    expect(isPostCategory("free")).toBe(true);
    expect(isPostCategory("")).toBe(false);
    expect(isPostCategory("all")).toBe(false);
  });
});
