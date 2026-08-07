import { describe, expect, it } from "vitest";
import {
  countLeaveDays,
  needsSecondApproval,
  transitionLeave,
  type Actor,
  type LeaveRequestLike,
} from "./leave";

const OWNER: Actor = { id: "u1", role: "employee" };
const MANAGER: Actor = { id: "m1", role: "manager" };
const ADMIN: Actor = { id: "a1", role: "admin" };

function req(over: Partial<LeaveRequestLike> = {}): LeaveRequestLike {
  return { userId: "u1", type: "annual", status: "pending", days: 2, ...over };
}

describe("needsSecondApproval", () => {
  it("3일 초과면 유형 무관 2단계 (병가 면제 시 유형 선택만으로 우회 가능)", () => {
    expect(needsSecondApproval(req({ days: 3 }))).toBe(false);
    expect(needsSecondApproval(req({ days: 3.5 }))).toBe(true);
    expect(needsSecondApproval(req({ days: 5, type: "sick" }))).toBe(true);
  });
});

describe("transitionLeave — approve", () => {
  it("1단계 결재: manager 승인 → approved + 차감", () => {
    const r = transitionLeave(req({ days: 2 }), "approve", MANAGER);
    expect(r).toEqual({ ok: true, nextStatus: "approved", deductDays: 2 });
  });

  it("2단계 결재: manager 1차 → approved_1 (차감 없음), admin 최종 → approved + 차감", () => {
    const first = transitionLeave(req({ days: 5 }), "approve", MANAGER);
    expect(first).toEqual({ ok: true, nextStatus: "approved_1", deductDays: 0 });

    const final = transitionLeave(
      req({ days: 5, status: "approved_1" }),
      "approve",
      ADMIN,
    );
    expect(final).toEqual({ ok: true, nextStatus: "approved", deductDays: 5 });
  });

  it("최종 승인은 admin만 — manager가 approved_1을 승인하면 거부", () => {
    const r = transitionLeave(
      req({ days: 5, status: "approved_1" }),
      "approve",
      MANAGER,
    );
    expect(r.ok).toBe(false);
  });

  it("1차 결재자는 최종 승인 불가 — 혼자 두 단계를 통과할 수 없다 (이중 통제)", () => {
    const r = transitionLeave(
      req({ days: 5, status: "approved_1", approverId: "a1" }),
      "approve",
      ADMIN, // a1 본인
    );
    expect(r.ok).toBe(false);

    const other = transitionLeave(
      req({ days: 5, status: "approved_1", approverId: "m1" }),
      "approve",
      ADMIN, // 다른 사람
    );
    expect(other.ok).toBe(true);
  });

  it("본인 신청은 결재 불가 (admin이어도)", () => {
    const r = transitionLeave(req({ userId: "a1" }), "approve", ADMIN);
    expect(r.ok).toBe(false);
  });

  it("employee는 결재 불가", () => {
    const r = transitionLeave(req(), "approve", { id: "e2", role: "employee" });
    expect(r.ok).toBe(false);
  });

  it("병가는 승인돼도 차감 0", () => {
    const r = transitionLeave(req({ type: "sick", days: 2 }), "approve", ADMIN);
    expect(r).toEqual({ ok: true, nextStatus: "approved", deductDays: 0 });
  });

  it("이미 승인/반려된 신청은 다시 결재 불가", () => {
    expect(transitionLeave(req({ status: "approved" }), "approve", ADMIN).ok).toBe(false);
    expect(transitionLeave(req({ status: "rejected" }), "approve", ADMIN).ok).toBe(false);
    expect(transitionLeave(req({ status: "cancelled" }), "approve", ADMIN).ok).toBe(false);
  });
});

describe("transitionLeave — reject / cancel", () => {
  it("반려는 pending과 approved_1에서 가능", () => {
    expect(transitionLeave(req(), "reject", MANAGER).ok).toBe(true);
    expect(
      transitionLeave(req({ status: "approved_1" }), "reject", ADMIN).ok,
    ).toBe(true);
    expect(
      transitionLeave(req({ status: "approved" }), "reject", ADMIN).ok,
    ).toBe(false);
  });

  it("취소는 본인 + pending에서만", () => {
    expect(transitionLeave(req(), "cancel", OWNER)).toEqual({
      ok: true,
      nextStatus: "cancelled",
      deductDays: 0,
    });
    expect(transitionLeave(req(), "cancel", ADMIN).ok).toBe(false);
    expect(
      transitionLeave(req({ status: "approved_1" }), "cancel", OWNER).ok,
    ).toBe(false);
  });
});

describe("countLeaveDays", () => {
  it("평일만 센다 (2026-08-10 월 ~ 08-16 일 = 5일)", () => {
    expect(countLeaveDays("annual", "2026-08-10", "2026-08-16")).toBe(5);
  });

  it("주말만 포함된 기간은 0", () => {
    expect(countLeaveDays("annual", "2026-08-15", "2026-08-16")).toBe(0);
  });

  it("휴일 목록의 날짜는 근무일에서 제외", () => {
    const holidays = new Set(["2026-08-12"]); // 수요일이 공휴일
    expect(
      countLeaveDays("annual", "2026-08-10", "2026-08-14", holidays),
    ).toBe(4);
  });

  it("평일 반차는 0.5, 주말·공휴일 반차는 0 (신청 차단)", () => {
    expect(countLeaveDays("half", "2026-08-10", "2026-08-10")).toBe(0.5);
    expect(countLeaveDays("half", "2026-08-15", "2026-08-15")).toBe(0); // 토
    const holidays = new Set(["2026-08-10"]);
    expect(countLeaveDays("half", "2026-08-10", "2026-08-10", holidays)).toBe(0);
  });

  it("역전된 기간은 0", () => {
    expect(countLeaveDays("annual", "2026-08-12", "2026-08-10")).toBe(0);
  });
});
