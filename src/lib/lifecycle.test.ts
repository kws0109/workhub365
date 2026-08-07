import { describe, expect, it, vi } from "vitest";
import {
  offboardSteps,
  onboardSteps,
  runPipeline,
  type LifecycleOps,
  type OffboardCtx,
  type OnboardCtx,
  type StepEvent,
} from "./lifecycle";

function mockOps(over: Partial<LifecycleOps> = {}): LifecycleOps {
  return {
    createUser: vi.fn(async () => ({ id: "new-user-id" })),
    setUserLicenses: vi.fn(async () => {}),
    addUserToGroup: vi.fn(async () => {}),
    setAccountEnabled: vi.fn(async () => {}),
    revokeSignInSessions: vi.fn(async () => {}),
    getUserLicenseSkuIds: vi.fn(async () => ["sku-1"]),
    getUserGroups: vi.fn(async () => [
      { id: "g1", displayName: "영업", dynamic: false },
    ]),
    removeUserFromGroup: vi.fn(async () => {}),
    ...over,
  };
}

function collect(): { events: StepEvent[]; emit: (e: StepEvent) => void } {
  const events: StepEvent[] = [];
  return { events, emit: (e) => void events.push(e) };
}

function onboardCtx(ops: LifecycleOps): OnboardCtx {
  return {
    params: {
      displayName: "테스트",
      mailNickname: "test1",
      department: "개발",
      jobTitle: "사원",
      skuIds: ["sku-1"],
      groupIds: ["g1", "g2"],
    },
    domain: "contoso.com",
    tempPassword: "Pw123!abc",
    ops,
  };
}

describe("runPipeline", () => {
  it("모든 단계 성공 시 running→ok 순서로 방출", async () => {
    const ops = mockOps();
    const { events, emit } = collect();
    const result = await runPipeline(onboardSteps(), onboardCtx(ops), emit);

    expect(result.ok).toBe(true);
    expect(events.map((e) => `${e.key}:${e.status}`)).toEqual([
      "create_user:running",
      "create_user:ok",
      "assign_license:running",
      "assign_license:ok",
      "add_groups:running",
      "add_groups:ok",
    ]);
  });

  it("단계 실패 시 이후 단계를 실행하지 않는다", async () => {
    const ops = mockOps({
      setUserLicenses: vi.fn(async () => {
        throw new Error("license boom");
      }),
    });
    const { events, emit } = collect();
    const result = await runPipeline(onboardSteps(), onboardCtx(ops), emit);

    expect(result).toEqual({ ok: false, failedStep: "assign_license" });
    expect(events.at(-1)).toMatchObject({
      key: "assign_license",
      status: "error",
      message: "license boom",
    });
    expect(ops.addUserToGroup).not.toHaveBeenCalled();
  });

  it("resumeFrom 이전 단계는 skipped 처리하고 실행하지 않는다", async () => {
    const ops = mockOps();
    const { events, emit } = collect();
    const ctx = onboardCtx(ops);
    ctx.createdUserId = "existing-id"; // 재시도 시 클라이언트가 돌려준 컨텍스트

    const result = await runPipeline(
      onboardSteps(),
      ctx,
      emit,
      "assign_license",
    );

    expect(result.ok).toBe(true);
    expect(ops.createUser).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ key: "create_user", status: "skipped" });
    expect(ops.setUserLicenses).toHaveBeenCalledWith(
      "existing-id",
      ["sku-1"],
      [],
    );
  });

  it("온보딩 1단계가 createdUserId를 컨텍스트에 채운다", async () => {
    const ops = mockOps();
    const ctx = onboardCtx(ops);
    await runPipeline(onboardSteps(), ctx, () => {});
    expect(ctx.createdUserId).toBe("new-user-id");
    expect(ops.setUserLicenses).toHaveBeenCalledWith(
      "new-user-id",
      ["sku-1"],
      [],
    );
  });
});

describe("offboardSteps", () => {
  it("차단→세션 철회→라이선스 회수→그룹 제거 순서로 실행", async () => {
    const calls: string[] = [];
    const ops = mockOps({
      setAccountEnabled: vi.fn(async () => void calls.push("block")),
      revokeSignInSessions: vi.fn(async () => void calls.push("revoke")),
      getUserLicenseSkuIds: vi.fn(async () => {
        calls.push("get_licenses");
        return ["sku-1", "sku-2"];
      }),
      setUserLicenses: vi.fn(async (_u, add, remove) => {
        calls.push(`reclaim:${add.length}+${remove.length}`);
      }),
      getUserGroups: vi.fn(async () => {
        calls.push("get_groups");
        return [{ id: "g1", displayName: "영업", dynamic: false }];
      }),
      removeUserFromGroup: vi.fn(async () => void calls.push("remove_group")),
    });
    const ctx: OffboardCtx = { targetUserId: "victim", ops };
    const result = await runPipeline(offboardSteps(), ctx, () => {});

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      "block",
      "revoke",
      "get_licenses",
      "reclaim:0+2",
      "get_groups",
      "remove_group",
    ]);
    expect(ops.setAccountEnabled).toHaveBeenCalledWith("victim", false);
  });

  it("라이선스가 없으면 회수를 건너뛴 메시지를 남긴다", async () => {
    const ops = mockOps({ getUserLicenseSkuIds: vi.fn(async () => []) });
    const { events, emit } = collect();
    await runPipeline(offboardSteps(), { targetUserId: "u", ops }, emit);
    const reclaim = events.find(
      (e) => e.key === "reclaim_licenses" && e.status === "ok",
    );
    expect(reclaim?.message).toBe("회수할 라이선스 없음");
    expect(ops.setUserLicenses).not.toHaveBeenCalled();
  });

  it("동적 멤버십 그룹은 제거를 건너뛴다 (멤버 제거 API가 항상 실패하므로)", async () => {
    const ops = mockOps({
      getUserGroups: vi.fn(async () => [
        { id: "g1", displayName: "영업", dynamic: false },
        { id: "g2", displayName: "전직원(동적)", dynamic: true },
      ]),
    });
    const ctx: OffboardCtx = { targetUserId: "u", ops };
    const result = await runPipeline(offboardSteps(), ctx, () => {});
    expect(result.ok).toBe(true);
    expect(ops.removeUserFromGroup).toHaveBeenCalledTimes(1);
    expect(ops.removeUserFromGroup).toHaveBeenCalledWith("u", "g1");
    expect(ctx.removedGroups).toEqual([{ id: "g1", displayName: "영업" }]);
  });

  it("감사용 컨텍스트: 회수한 skuId 목록이 ctx에 남는다", async () => {
    const ops = mockOps({
      getUserLicenseSkuIds: vi.fn(async () => ["sku-1", "sku-2"]),
    });
    const ctx: OffboardCtx = { targetUserId: "u", ops };
    await runPipeline(offboardSteps(), ctx, () => {});
    expect(ctx.reclaimedSkuIds).toEqual(["sku-1", "sku-2"]);
  });
});

describe("재개(resume) 안전성", () => {
  it("알 수 없는 resumeFrom은 전 단계 skip 후 성공이 아니라 즉시 던진다", async () => {
    const ops = mockOps();
    await expect(
      runPipeline(
        offboardSteps(),
        { targetUserId: "u", ops },
        () => {},
        "reclaim", // 오타 — 올바른 키는 reclaim_licenses
      ),
    ).rejects.toThrow("UNKNOWN_RESUME_STEP");
    expect(ops.setAccountEnabled).not.toHaveBeenCalled();
  });

  it("add_groups 재시도: 이미 배정된 그룹은 성공으로 취급 (멱등)", async () => {
    const ops = mockOps({
      addUserToGroup: vi
        .fn()
        .mockRejectedValueOnce(
          new Error("One or more added object references already exist"),
        )
        .mockResolvedValue(undefined),
    });
    const ctx = onboardCtx(ops);
    ctx.createdUserId = "existing-id";
    const { events, emit } = collect();
    const result = await runPipeline(onboardSteps(), ctx, emit, "add_groups");
    expect(result.ok).toBe(true);
    const ok = events.find((e) => e.key === "add_groups" && e.status === "ok");
    expect(ok?.message).toBe("2개 그룹");
  });
});
