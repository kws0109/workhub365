import { describe, expect, it } from "vitest";
import {
  APPROVAL_TTL_MS,
  canDecide,
  displayStatus,
  expiryFrom,
  isExpired,
  type ApprovalLike,
} from "./approval";

const NOW = new Date("2026-08-09T12:00:00+09:00");

function req(over: Partial<ApprovalLike> = {}): ApprovalLike {
  return {
    status: "pending",
    expiresAt: new Date(NOW.getTime() + 60_000),
    ...over,
  };
}

describe("canDecide", () => {
  it("pending + 만료 전 → 승인/거부 가능", () => {
    expect(canDecide(req(), NOW)).toEqual({ ok: true });
  });

  it("만료 시각이 지난 pending → 불가 (뒤늦은 실행 차단)", () => {
    const r = canDecide(req({ expiresAt: new Date(NOW.getTime() - 1) }), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("만료");
  });

  it("만료 시각 정각도 만료로 취급한다 (경계 포함)", () => {
    const r = canDecide(req({ expiresAt: NOW }), NOW);
    expect(r.ok).toBe(false);
  });

  it("이미 executing인 요청 → 불가 (동시 승인 이중 실행 차단의 사용자 메시지 경로)", () => {
    const r = canDecide(req({ status: "executing" }), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("이미 처리");
  });

  it.each(["rejected", "executed", "failed", "approved"] as const)(
    "%s 상태 → 불가",
    (status) => {
      expect(canDecide(req({ status }), NOW).ok).toBe(false);
    },
  );

  it("expiresAt이 null이면 만료 없이 pending 판정을 따른다", () => {
    expect(canDecide(req({ expiresAt: null }), NOW)).toEqual({ ok: true });
  });
});

describe("isExpired / displayStatus", () => {
  it("pending이 아닌 상태는 만료 시각이 지나도 expired가 아니다 (종결 상태 우선)", () => {
    const r = req({ status: "executed", expiresAt: new Date(NOW.getTime() - 1) });
    expect(isExpired(r, NOW)).toBe(false);
    expect(displayStatus(r, NOW)).toBe("executed");
  });

  it("만료된 pending은 표시 상태가 expired다", () => {
    const r = req({ expiresAt: new Date(NOW.getTime() - 1) });
    expect(displayStatus(r, NOW)).toBe("expired");
  });
});

describe("expiryFrom", () => {
  it("생성 시각 + TTL(15분)", () => {
    expect(expiryFrom(NOW).getTime()).toBe(NOW.getTime() + APPROVAL_TTL_MS);
  });
});
