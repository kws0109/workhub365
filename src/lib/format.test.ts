import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("1KB 미만은 B 그대로", () => {
    expect(formatBytes(0)).toBe("0B");
    expect(formatBytes(512)).toBe("512B");
    expect(formatBytes(1023)).toBe("1023B");
  });

  it("KB·MB·GB·TB 경계", () => {
    expect(formatBytes(1024)).toBe("1KB");
    expect(formatBytes(1536)).toBe("1.5KB");
    expect(formatBytes(1024 * 1024)).toBe("1MB");
    expect(formatBytes(5.6 * 1024 * 1024)).toBe("5.6MB");
    expect(formatBytes(743 * 1024 ** 3)).toBe("743GB");
    expect(formatBytes(1024 ** 4)).toBe("1TB");
  });

  it("정수로 떨어지면 소수점 생략", () => {
    expect(formatBytes(2 * 1024)).toBe("2KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3MB");
  });

  it("null·음수·비정상 값은 대시", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});
