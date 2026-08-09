import { describe, expect, it } from "vitest";
import { canEditRecordOf, isHrEditor } from "./hr";

describe("isHrEditor", () => {
  it("admin은 플래그 없이도 인사 정정 권한을 갖는다 (데드락 방지 겸임)", () => {
    expect(isHrEditor({ role: "admin", hrAdmin: false })).toBe(true);
  });
  it("employee여도 hrAdmin이면 권한이 있다 (역할과 직교)", () => {
    expect(isHrEditor({ role: "employee", hrAdmin: true })).toBe(true);
  });
  it("manager라는 이유만으로는 권한이 없다", () => {
    expect(isHrEditor({ role: "manager", hrAdmin: false })).toBe(false);
  });
  it("일반 직원은 권한이 없다", () => {
    expect(isHrEditor({ role: "employee", hrAdmin: false })).toBe(false);
  });
});

describe("canEditRecordOf", () => {
  const hr = { id: "u-hr", role: "employee" as const, hrAdmin: true };

  it("권한자는 타인 기록을 정정할 수 있다", () => {
    expect(canEditRecordOf(hr, "u-other")).toBe(true);
  });
  it("권한자도 본인 기록은 정정할 수 없다", () => {
    expect(canEditRecordOf(hr, "u-hr")).toBe(false);
  });
  it("admin도 본인 기록은 예외 없이 불가", () => {
    expect(
      canEditRecordOf({ id: "u-a", role: "admin", hrAdmin: true }, "u-a"),
    ).toBe(false);
  });
  it("비권한자는 타인 기록을 정정할 수 없다", () => {
    expect(
      canEditRecordOf({ id: "u-e", role: "employee", hrAdmin: false }, "u-x"),
    ).toBe(false);
  });
});
