import { describe, expect, it } from "vitest";
import { actionErrorMessage, isUuid } from "./validate";

describe("isUuid", () => {
  it("정규 형식의 uuid를 대소문자 무관하게 통과시킨다", () => {
    expect(isUuid("11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(isUuid("A1B2C3D4-E5F6-4789-ABCD-0123456789EF")).toBe(true);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
  });

  it("형식이 다르면 거부한다 — uuid 컬럼 비교(22P02)에 닿기 전에 막는 것이 목적", () => {
    for (const bad of [
      "",
      "x",
      "11111111111111111111111111111111",
      "11111111-1111-1111-1111-11111111111",
      "11111111-1111-1111-1111-1111111111111",
      "1111111g-1111-1111-1111-111111111111",
      " 11111111-1111-1111-1111-111111111111",
      "11111111-1111-1111-1111-111111111111 ",
    ]) {
      expect(isUuid(bad), `"${bad}"가 통과함`).toBe(false);
    }
  });

  it("개행이 붙은 값도 거부한다 — 앵커가 줄 단위가 아니어야 한다", () => {
    expect(isUuid("11111111-1111-1111-1111-111111111111\n")).toBe(false);
  });

  it("문자열이 아니면 거부한다 (FormData 외 경로의 방어)", () => {
    for (const bad of [null, undefined, 123, {}, [], true]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});

describe("actionErrorMessage", () => {
  it("앱이 의도적으로 던진 Error 메시지는 그대로 통과시킨다", () => {
    expect(actionErrorMessage(new Error("신청을 찾을 수 없습니다"))).toBe(
      "신청을 찾을 수 없습니다",
    );
  });

  it("code 속성을 가진 드라이버 오류는 일반 문구로 접는다", () => {
    const pgError = Object.assign(
      new Error('invalid input syntax for type uuid: "x"'),
      { code: "22P02" },
    );
    expect(actionErrorMessage(pgError)).toBe("처리 중 오류가 발생했습니다");

    const sysError = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    expect(actionErrorMessage(sysError)).toBe("처리 중 오류가 발생했습니다");
  });

  it("Error가 아닌 값과 빈 메시지도 일반 문구로 접는다", () => {
    expect(actionErrorMessage("문자열 throw")).toBe("처리 중 오류가 발생했습니다");
    expect(actionErrorMessage(undefined)).toBe("처리 중 오류가 발생했습니다");
    expect(actionErrorMessage(new Error(""))).toBe("처리 중 오류가 발생했습니다");
  });

  it("호출부가 대체 문구를 지정할 수 있다", () => {
    const pgError = Object.assign(new Error("22P02"), { code: "22P02" });
    expect(actionErrorMessage(pgError, "휴가 처리에 실패했습니다")).toBe(
      "휴가 처리에 실패했습니다",
    );
  });
});
