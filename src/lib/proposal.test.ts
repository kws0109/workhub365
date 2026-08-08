import { describe, expect, it } from "vitest";
import {
  getTemplate,
  nextProposalState,
  resolveDefaultLine,
  validateContent,
  validateLine,
  type UserLike,
} from "./proposal";

const USERS: UserLike[] = [
  { id: "a1", name: "관리자", department: "개발", role: "admin" },
  { id: "m1", name: "개발매니저", department: "개발", role: "manager" },
  { id: "m2", name: "영업매니저", department: "영업", role: "manager" },
  { id: "e1", name: "직원", department: "개발", role: "employee" },
  { id: "e2", name: "무부서직원", department: null, role: "employee" },
];

describe("resolveDefaultLine", () => {
  it("부서 매니저 → 관리자 순으로 구성", () => {
    const author = USERS.find((u) => u.id === "e1")!;
    const line = resolveDefaultLine(["dept_manager", "admin"], author, USERS);
    expect(line.map((l) => l.id)).toEqual(["m1", "a1"]);
  });

  it("작성자가 부서 매니저면 본인은 제외", () => {
    const author = USERS.find((u) => u.id === "m1")!;
    const line = resolveDefaultLine(["dept_manager", "admin"], author, USERS);
    expect(line.map((l) => l.id)).toEqual(["a1"]); // 같은 부서 다른 매니저 없음 → admin만
  });

  it("작성자가 유일한 admin이면 admin 규칙은 비고, 부서 매니저만 남는다", () => {
    const author = USERS.find((u) => u.id === "a1")!;
    const line = resolveDefaultLine(["dept_manager", "admin"], author, USERS);
    expect(line.map((l) => l.id)).toEqual(["m1"]);
  });

  it("부서가 없는 작성자는 dept_manager 규칙이 매칭되지 않는다", () => {
    const author = USERS.find((u) => u.id === "e2")!;
    const line = resolveDefaultLine(["dept_manager", "admin"], author, USERS);
    expect(line.map((l) => l.id)).toEqual(["a1"]);
  });

  it("중복 인원은 한 번만 (매니저가 admin과 동일 인물인 경우 등)", () => {
    const solo: UserLike[] = [
      { id: "x", name: "작성자", department: "개발", role: "employee" },
      { id: "y", name: "겸직", department: "개발", role: "manager" },
    ];
    const line = resolveDefaultLine(
      ["dept_manager", "dept_manager"],
      solo[0],
      solo,
    );
    expect(line.map((l) => l.id)).toEqual(["y"]);
  });
});

describe("validateContent", () => {
  const template = getTemplate("expense")!;

  it("필수 필드 누락을 잡는다", () => {
    const r = validateContent(template, { amount: "10000" });
    expect(r.ok).toBe(false);
  });

  it("숫자·날짜·선택 필드를 검증한다", () => {
    const base = {
      amount: "35000",
      usedAt: "2026-08-20",
      vendor: "OO식당",
      category: "식대",
      reason: "팀 회식",
    };
    expect(validateContent(template, base).ok).toBe(true);
    expect(validateContent(template, { ...base, amount: "-5" }).ok).toBe(false);
    expect(validateContent(template, { ...base, usedAt: "8월20일" }).ok).toBe(false);
    expect(validateContent(template, { ...base, category: "회식비" }).ok).toBe(false);
  });

  it("형태만 맞는 가짜 날짜(2026-02-31)를 거부한다", () => {
    const base = {
      amount: "1000",
      usedAt: "2026-02-31",
      vendor: "x",
      category: "기타",
      reason: "r",
    };
    expect(validateContent(template, base).ok).toBe(false);
    expect(validateContent(template, { ...base, usedAt: "2026-02-28" }).ok).toBe(true);
  });

  it("검증 통과 시 정의된 필드만 스냅샷에 남는다", () => {
    const r = validateContent(template, {
      amount: "1000",
      usedAt: "2026-08-20",
      vendor: "x",
      category: "기타",
      reason: "r",
      hacker: "주입 시도",
    });
    expect(r.ok && "hacker" in r.content).toBe(false);
  });
});

describe("validateLine", () => {
  it("작성자 포함·중복·인원 범위를 거부한다", () => {
    expect(validateLine([], "me").ok).toBe(false);
    expect(validateLine(["me", "a"], "me").ok).toBe(false);
    expect(validateLine(["a", "a"], "me").ok).toBe(false);
    expect(validateLine(["a", "b", "c", "d", "e", "f"], "me").ok).toBe(false);
    expect(validateLine(["a", "b"], "me").ok).toBe(true);
  });
});

describe("nextProposalState", () => {
  it("중간 승인은 다음 단계로, 마지막 승인은 approved", () => {
    expect(nextProposalState(1, 2, "approve")).toEqual({
      ok: true,
      proposalStatus: "in_progress",
      nextStep: 2,
    });
    expect(nextProposalState(2, 2, "approve")).toEqual({
      ok: true,
      proposalStatus: "approved",
      nextStep: 2,
    });
  });

  it("반려는 어느 단계든 즉시 rejected", () => {
    expect(nextProposalState(1, 3, "reject")).toEqual({
      ok: true,
      proposalStatus: "rejected",
      nextStep: 1,
    });
  });

  it("범위 밖 단계는 거부", () => {
    expect(nextProposalState(0, 2, "approve").ok).toBe(false);
    expect(nextProposalState(3, 2, "approve").ok).toBe(false);
  });
});
