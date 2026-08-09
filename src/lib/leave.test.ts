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

// ─────────────────────────────────────────────────────────────
// HR 기록 정정 (R5.x)
// 위 describe들은 한 줄도 수정하지 않았다 — transitionLeave 불변식 무손상의 증명
// ─────────────────────────────────────────────────────────────
import {
  correctLeave,
  leaveBalanceDelta,
  leaveBalanceWeight,
  type LeaveCorrectionInput,
  type LeaveCorrectionResult,
  type LeaveSnapshot,
} from "./leave";

type HrActor = { id: string; hrEditor: boolean };

const HR: HrActor = { id: "hr1", hrEditor: true };
const NOT_HR: HrActor = { id: "hr1", hrEditor: false };

// 2026-08-10(월) ~ 08-14(금)이 근무일 5일 — 기본 스냅샷은 08-10~08-12 = 3일
function snap(over: Partial<LeaveSnapshot> = {}): LeaveSnapshot {
  return {
    userId: "u1",
    type: "annual",
    status: "approved",
    startDate: "2026-08-10",
    endDate: "2026-08-12",
    days: 3,
    approverId: "m1",
    ...over,
  };
}

function input(
  over: Partial<LeaveCorrectionInput> = {},
): LeaveCorrectionInput {
  return {
    type: "annual",
    startDate: "2026-08-10",
    endDate: "2026-08-12",
    days: 3,
    cancel: false,
    ...over,
  };
}

// 유니온 좁히기용 — 거부되면 이유를 그대로 실패 메시지로 노출한다
function expectOk(r: LeaveCorrectionResult) {
  if (!r.ok) throw new Error(`정정이 거부됐다: ${r.reason}`);
  return r;
}

describe("leaveBalanceWeight", () => {
  it("approved & 비병가일 때만 days만큼 무게를 갖는다", () => {
    expect(leaveBalanceWeight({ status: "approved", type: "annual", days: 3 })).toBe(3);
    expect(leaveBalanceWeight({ status: "approved", type: "half", days: 0.5 })).toBe(0.5);
    expect(leaveBalanceWeight({ status: "approved", type: "sick", days: 3 })).toBe(0);
  });

  it("approved가 아닌 상태는 전부 0 (미차감분을 복원 대상으로 세지 않는다)", () => {
    expect(leaveBalanceWeight({ status: "pending", type: "annual", days: 3 })).toBe(0);
    expect(leaveBalanceWeight({ status: "approved_1", type: "annual", days: 3 })).toBe(0);
    expect(leaveBalanceWeight({ status: "rejected", type: "annual", days: 3 })).toBe(0);
    expect(leaveBalanceWeight({ status: "cancelled", type: "annual", days: 3 })).toBe(0);
  });
});

describe("leaveBalanceDelta — 잔여 연차 전이 매트릭스", () => {
  it("approved/annual/3 → cancelled = -3 (복원)", () => {
    expect(
      leaveBalanceDelta(
        { status: "approved", type: "annual", days: 3 },
        { status: "cancelled", type: "annual", days: 3 },
      ),
    ).toBe(-3);
  });

  it("approved 유지 3 → 5 = +2 (식 자체는 증가를 표현한다 — 거부는 correctLeave의 몫)", () => {
    expect(
      leaveBalanceDelta(
        { status: "approved", type: "annual", days: 3 },
        { status: "approved", type: "annual", days: 5 },
      ),
    ).toBe(2);
  });

  it("approved 유지 5 → 3 = -2", () => {
    expect(
      leaveBalanceDelta(
        { status: "approved", type: "annual", days: 5 },
        { status: "approved", type: "annual", days: 3 },
      ),
    ).toBe(-2);
  });

  it("approved annual → sick = -days", () => {
    expect(
      leaveBalanceDelta(
        { status: "approved", type: "annual", days: 3 },
        { status: "approved", type: "sick", days: 3 },
      ),
    ).toBe(-3);
  });

  it("approved sick → annual = +days", () => {
    expect(
      leaveBalanceDelta(
        { status: "approved", type: "sick", days: 3 },
        { status: "approved", type: "annual", days: 3 },
      ),
    ).toBe(3);
  });

  it("approved sick → cancelled = 0 (병가는 애초에 차감되지 않았다)", () => {
    expect(
      leaveBalanceDelta(
        { status: "approved", type: "sick", days: 3 },
        { status: "cancelled", type: "sick", days: 3 },
      ),
    ).toBe(0);
  });

  it("pending 기간 변경 = 0", () => {
    expect(
      leaveBalanceDelta(
        { status: "pending", type: "annual", days: 3 },
        { status: "pending", type: "annual", days: 5 },
      ),
    ).toBe(0);
  });

  it("approved_1 → cancelled = 0 (미차감분 복원 금지)", () => {
    expect(
      leaveBalanceDelta(
        { status: "approved_1", type: "annual", days: 5 },
        { status: "cancelled", type: "annual", days: 5 },
      ),
    ).toBe(0);
  });

  it("approved half 0.5 → cancelled = -0.5 (0.5 배수 정확성)", () => {
    expect(
      leaveBalanceDelta(
        { status: "approved", type: "half", days: 0.5 },
        { status: "cancelled", type: "half", days: 0.5 },
      ),
    ).toBe(-0.5);
  });

  it("동일 스냅샷 = 0 (항등)", () => {
    const same = { status: "approved", type: "annual", days: 3 } as const;
    expect(leaveBalanceDelta(same, same)).toBe(0);
  });
});

describe("correctLeave — 거부", () => {
  it("인사 정정 권한이 없으면 거부 (권한 판정이 셀프 판정보다 먼저)", () => {
    expect(correctLeave(snap(), input(), NOT_HR)).toEqual({
      ok: false,
      reason: "인사 정정 권한이 없습니다",
    });
    expect(
      correctLeave(snap({ userId: "hr1" }), input(), NOT_HR),
    ).toEqual({ ok: false, reason: "인사 정정 권한이 없습니다" });
  });

  it("본인 기록은 정정할 수 없다 (권한자여도 예외 없음)", () => {
    expect(correctLeave(snap({ userId: "hr1" }), input(), HR)).toEqual({
      ok: false,
      reason: "본인 기록은 정정할 수 없습니다",
    });
  });

  it("종결된 신청(rejected/cancelled)은 정정할 수 없다", () => {
    expect(correctLeave(snap({ status: "rejected" }), input(), HR)).toEqual({
      ok: false,
      reason: "종결된 신청은 정정할 수 없습니다",
    });
    expect(correctLeave(snap({ status: "cancelled" }), input(), HR)).toEqual({
      ok: false,
      reason: "종결된 신청은 정정할 수 없습니다",
    });
    // 취소 요청이어도 마찬가지 — 종결 건은 되살릴 수 없다
    expect(
      correctLeave(snap({ status: "cancelled" }), input({ cancel: true }), HR).ok,
    ).toBe(false);
  });

  it("재계산된 일수가 0 이하면 거부 (근무일 없음·기간 역전)", () => {
    expect(correctLeave(snap(), input({ days: 0 }), HR)).toEqual({
      ok: false,
      reason: "기간에 근무일이 없거나 순서가 잘못되었습니다",
    });
  });

  it("기간이 역전되면 거부", () => {
    expect(
      correctLeave(
        snap(),
        input({ startDate: "2026-08-12", endDate: "2026-08-10" }),
        HR,
      ),
    ).toEqual({ ok: false, reason: "기간 순서가 잘못되었습니다" });
  });

  it("반차는 하루만 지정할 수 있다", () => {
    expect(
      correctLeave(
        snap(),
        input({
          type: "half",
          startDate: "2026-08-10",
          endDate: "2026-08-11",
          days: 0.5,
        }),
        HR,
      ),
    ).toEqual({ ok: false, reason: "반차는 하루만 지정할 수 있습니다" });
  });

  it("결재된 건의 일수 증가는 전면 금지 — 4일 → 40일 (둘 다 임계 초과라 임계 비교로는 통과하던 구멍)", () => {
    expect(
      correctLeave(
        snap({ endDate: "2026-08-13", days: 4 }),
        input({ endDate: "2026-10-02", days: 40 }),
        HR,
      ),
    ).toEqual({
      ok: false,
      reason: "결재된 신청의 일수는 늘릴 수 없습니다. 정정 취소 후 재신청하세요",
    });
  });

  it("결재된 건의 일수 증가는 전면 금지 — 3일 → 5일 (임계 통과)", () => {
    expect(
      correctLeave(snap(), input({ endDate: "2026-08-14", days: 5 }), HR).ok,
    ).toBe(false);
  });

  it("approved_1도 결재된 건 — 4일 → 5일 거부", () => {
    expect(
      correctLeave(
        snap({ status: "approved_1", endDate: "2026-08-13", days: 4 }),
        input({ endDate: "2026-08-14", days: 5 }),
        HR,
      ).ok,
    ).toBe(false);
  });

  it("병가로 바꾸면서 늘리는 우회도 막는다 — approved annual 3일 → sick 5일", () => {
    expect(
      correctLeave(
        snap(),
        input({ type: "sick", endDate: "2026-08-14", days: 5 }),
        HR,
      ).ok,
    ).toBe(false);
  });
});

describe("correctLeave — 허용", () => {
  it("pending은 결재 전이므로 일수 증가 허용 — 3일 → 5일, 델타 0", () => {
    const r = expectOk(
      correctLeave(
        snap({ status: "pending", approverId: null }),
        input({ endDate: "2026-08-14", days: 5 }),
        HR,
      ),
    );
    expect(r.after.status).toBe("pending");
    expect(r.after.days).toBe(5);
    expect(r.after.endDate).toBe("2026-08-14");
    expect(r.balanceDelta).toBe(0);
  });

  it("approved 5일 → 3일, 델타 -2", () => {
    const r = expectOk(
      correctLeave(
        snap({ endDate: "2026-08-14", days: 5 }),
        input({ endDate: "2026-08-12", days: 3 }),
        HR,
      ),
    );
    expect(r.balanceDelta).toBe(-2);
    expect(r.after.status).toBe("approved");
  });

  it("approved 5일 → 4일, 델타 -1", () => {
    const r = expectOk(
      correctLeave(
        snap({ endDate: "2026-08-14", days: 5 }),
        input({ endDate: "2026-08-13", days: 4 }),
        HR,
      ),
    );
    expect(r.balanceDelta).toBe(-1);
  });

  it("approved annual 3일 → sick 3일, 델타 -3 (차감 복원)", () => {
    const r = expectOk(correctLeave(snap(), input({ type: "sick" }), HR));
    expect(r.after.type).toBe("sick");
    expect(r.balanceDelta).toBe(-3);
  });

  it("approved sick 3일 → annual 3일, 델타 +3 (추가 차감)", () => {
    const r = expectOk(
      correctLeave(snap({ type: "sick" }), input({ type: "annual" }), HR),
    );
    expect(r.after.type).toBe("annual");
    expect(r.balanceDelta).toBe(3);
  });

  it("approved annual 3일 → 반차 0.5일, 델타 -2.5", () => {
    const r = expectOk(
      correctLeave(
        snap(),
        input({
          type: "half",
          startDate: "2026-08-10",
          endDate: "2026-08-10",
          days: 0.5,
        }),
        HR,
      ),
    );
    expect(r.after.days).toBe(0.5);
    expect(r.balanceDelta).toBe(-2.5);
  });
});

describe("correctLeave — 취소(cancel:true)", () => {
  it("approved/annual/3 취소 → status만 cancelled, 내용은 그대로, 델타 -3", () => {
    const before = snap();
    const r = expectOk(correctLeave(before, input({ cancel: true }), HR));
    expect(r.after.status).toBe("cancelled");
    expect(r.after.type).toBe(before.type);
    expect(r.after.startDate).toBe(before.startDate);
    expect(r.after.endDate).toBe(before.endDate);
    expect(r.after.days).toBe(before.days);
    expect(r.balanceDelta).toBe(-3);
  });

  it("취소는 입력의 내용 필드를 통째로 무시한다 (일수 증가 입력이 섞여도 거부되지 않는다)", () => {
    const before = snap();
    const r = expectOk(
      correctLeave(
        before,
        input({
          cancel: true,
          type: "sick",
          startDate: "2026-09-01",
          endDate: "2026-10-02",
          days: 40,
        }),
        HR,
      ),
    );
    expect(r.after).toEqual({ ...before, status: "cancelled" });
    expect(r.balanceDelta).toBe(-3);
  });

  it("approved_1/annual/5 취소 → 델타 0 (아직 차감되지 않았다)", () => {
    const r = expectOk(
      correctLeave(
        snap({ status: "approved_1", endDate: "2026-08-14", days: 5 }),
        input({ cancel: true }),
        HR,
      ),
    );
    expect(r.after.status).toBe("cancelled");
    expect(r.balanceDelta).toBe(0);
  });

  it("pending 취소 → 델타 0", () => {
    const r = expectOk(
      correctLeave(
        snap({ status: "pending", approverId: null }),
        input({ cancel: true }),
        HR,
      ),
    );
    expect(r.after.status).toBe("cancelled");
    expect(r.balanceDelta).toBe(0);
  });
});

describe("correctLeave — 불변식", () => {
  const okCases: { name: string; before: LeaveSnapshot; given: LeaveCorrectionInput }[] = [
    {
      name: "pending 기간 증가",
      before: snap({ status: "pending" }),
      given: input({ endDate: "2026-08-14", days: 5 }),
    },
    {
      name: "approved 기간 축소",
      before: snap({ endDate: "2026-08-14", days: 5 }),
      given: input({ endDate: "2026-08-12", days: 3 }),
    },
    {
      name: "approved annual → sick",
      before: snap(),
      given: input({ type: "sick" }),
    },
    {
      name: "approved sick → annual",
      before: snap({ type: "sick" }),
      given: input({ type: "annual" }),
    },
    {
      name: "approved → 반차",
      before: snap(),
      given: input({
        type: "half",
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        days: 0.5,
      }),
    },
    {
      name: "approved 취소",
      before: snap(),
      given: input({ cancel: true }),
    },
    {
      name: "approved_1 취소",
      before: snap({ status: "approved_1", endDate: "2026-08-14", days: 5 }),
      given: input({ cancel: true }),
    },
    {
      name: "pending 취소",
      before: snap({ status: "pending" }),
      given: input({ cancel: true }),
    },
  ];

  for (const c of okCases) {
    it(`${c.name}: approverId·userId가 보존된다 (2단계 이중 통제 무력화 금지)`, () => {
      const r = expectOk(correctLeave(c.before, c.given, HR));
      expect(r.after.approverId).toBe(c.before.approverId);
      expect(r.after.userId).toBe(c.before.userId);
    });

    it(`${c.name}: balanceDelta가 leaveBalanceDelta(before, after)와 일치한다`, () => {
      const r = expectOk(correctLeave(c.before, c.given, HR));
      expect(r.balanceDelta).toBe(leaveBalanceDelta(c.before, r.after));
    });
  }

  it("상태는 절대 상향되지 않는다 — 정정 후에도 before.status가 유지된다", () => {
    for (const status of ["pending", "approved_1", "approved"] as const) {
      const before = snap({ status });
      const r = expectOk(
        correctLeave(before, input({ endDate: "2026-08-11", days: 2 }), HR),
      );
      expect(r.after.status).toBe(status);
    }
  });
});
