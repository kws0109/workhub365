import { describe, expect, it, vi } from "vitest";
import { TOOLS, executeTool, getTool, toolInputJsonSchema } from "./tools";
import type { ToolContext } from "./types";

// 승인 게이트 시나리오 테스트 (R5.3 수용 기준):
// "승인 없이 파괴 액션이 실행되는 경로가 존재하지 않음"을 구조적으로 검증한다.

function mockCtx(): ToolContext {
  return {
    getLicenseOverview: vi.fn(async () => ({
      inactiveDays: 30,
      signInAvailable: true,
      totalsKrw: { unassigned: 0, assigned: 0, total: 0 },
      skus: [],
      topWasteUsers: [],
    })),
    findUsers: vi.fn(async () => []),
    getUserDetail: vi.fn(async () => null),
    getOvertimeStatus: vi.fn(async () => ({ weekStart: "2026-08-03", rows: [] })),
    listGroups: vi.fn(async () => []),
    createUser: vi.fn(async () => ({
      id: "u1",
      userPrincipalName: "a@b.c",
      tempPassword: "pw",
      assignedSkuIds: [],
      addedGroups: [],
    })),
    blockUser: vi.fn(async () => {}),
    revokeUserSessions: vi.fn(async () => {}),
    removeUserLicense: vi.fn(async () => {}),
    removeUserFromGroup: vi.fn(async () => {}),
  };
}

/** 각 도구가 게이트 테스트에서 사용할 유효 입력 */
const VALID_INPUT: Record<string, unknown> = {
  get_license_overview: { inactiveDays: 30 },
  find_users: { query: "김" },
  get_user_detail: { userId: "11111111-1111-1111-1111-111111111111" },
  get_overtime_status: {},
  list_groups: {},
  create_user: { displayName: "김철수", mailNickname: "chulsoo.kim" },
  block_user: { userId: "11111111-1111-1111-1111-111111111111" },
  revoke_user_sessions: { userId: "11111111-1111-1111-1111-111111111111" },
  remove_user_license: {
    userId: "11111111-1111-1111-1111-111111111111",
    skuId: "22222222-2222-2222-2222-222222222222",
  },
  remove_user_from_group: {
    userId: "11111111-1111-1111-1111-111111111111",
    groupId: "33333333-3333-3333-3333-333333333333",
  },
};

/** 변경형 도구가 실행 시 호출하는 ctx 메서드 매핑 */
const MUTATION_CTX_METHOD: Record<string, keyof ToolContext> = {
  create_user: "createUser",
  block_user: "blockUser",
  revoke_user_sessions: "revokeUserSessions",
  remove_user_license: "removeUserLicense",
  remove_user_from_group: "removeUserFromGroup",
};

const mutationTools = TOOLS.filter((t) => t.requiresApproval);
const readTools = TOOLS.filter((t) => !t.requiresApproval);

describe("도구 레지스트리 불변식", () => {
  it("모든 도구에 게이트 테스트용 유효 입력 픽스처가 있다", () => {
    for (const t of TOOLS) {
      expect(VALID_INPUT, `${t.name} 픽스처 누락`).toHaveProperty(t.name);
    }
  });

  it("R5.3의 파괴 액션(계정 생성·차단, 라이선스 회수, 세션 철회, 그룹 제거)은 전부 requiresApproval이다", () => {
    const names = new Set(mutationTools.map((t) => t.name));
    for (const required of [
      "create_user",
      "block_user",
      "revoke_user_sessions",
      "remove_user_license",
      "remove_user_from_group",
    ]) {
      expect(names.has(required), `${required}가 승인 게이트 대상이 아님`).toBe(true);
    }
  });

  it("계정 삭제 도구는 존재하지 않는다 — 노출하지 않는 것이 가장 강한 게이트", () => {
    expect(getTool("delete_user")).toBeUndefined();
  });

  it("조회형 도구는 실행돼도 변경형 ctx 메서드를 절대 호출하지 않는다", async () => {
    // 조회형 도구가 실수로 변경형 ctx 메서드를 부르면(승인 게이트 없이 부수효과)
    // 여기서 잡힌다 — R5.3의 나머지 절반
    for (const t of readTools) {
      const ctx = mockCtx();
      const out = await executeTool(t.name, VALID_INPUT[t.name], ctx);
      expect(out.kind, `${t.name} 실행 실패`).toBe("ok");
      for (const method of Object.values(MUTATION_CTX_METHOD)) {
        expect(
          ctx[method],
          `조회형 ${t.name}이(가) 변경형 ${String(method)}를 호출함`,
        ).not.toHaveBeenCalled();
      }
    }
    for (const [toolName] of Object.entries(MUTATION_CTX_METHOD)) {
      expect(getTool(toolName)?.requiresApproval).toBe(true);
    }
  });

  it("모든 도구 스키마는 Claude API용 JSON Schema(object)로 변환된다", () => {
    for (const t of TOOLS) {
      const schema = toolInputJsonSchema(t);
      expect(schema.type).toBe("object");
      expect(schema).not.toHaveProperty("$schema");
    }
  });
});

describe("executeTool — 승인 게이트", () => {
  for (const t of mutationTools) {
    it(`${t.name}: approvalGranted 없이는 실행되지 않고 approval_required를 반환한다`, async () => {
      const ctx = mockCtx();
      const out = await executeTool(t.name, VALID_INPUT[t.name], ctx);
      expect(out.kind).toBe("approval_required");
      // 어떤 ctx 메서드도 호출되지 않아야 한다 (조회 포함 — 부수효과 전무)
      for (const fn of Object.values(ctx)) {
        expect(fn).not.toHaveBeenCalled();
      }
    });
  }

  it("approvalGranted를 명시하면 변경형 도구가 해당 ctx 메서드를 정확히 1회 호출한다", async () => {
    for (const [toolName, method] of Object.entries(MUTATION_CTX_METHOD)) {
      const ctx = mockCtx();
      const out = await executeTool(toolName, VALID_INPUT[toolName], ctx, {
        approvalGranted: true,
      });
      expect(out.kind, `${toolName} 실행 실패`).toBe("ok");
      expect(ctx[method]).toHaveBeenCalledTimes(1);
    }
  });

  it("approvalGranted가 있어도 입력 검증 실패면 실행되지 않는다", async () => {
    const ctx = mockCtx();
    const out = await executeTool("block_user", { userId: 123 }, ctx, {
      approvalGranted: true,
    });
    expect(out.kind).toBe("error");
    expect(ctx.blockUser).not.toHaveBeenCalled();
  });

  it("알 수 없는 도구는 error를 반환한다", async () => {
    const out = await executeTool("drop_database", {}, mockCtx());
    expect(out).toEqual({ kind: "error", message: "알 수 없는 도구: drop_database" });
  });
});

describe("executeTool — 조회형", () => {
  for (const t of readTools) {
    it(`${t.name}: 승인 없이 즉시 실행된다`, async () => {
      const ctx = mockCtx();
      const out = await executeTool(t.name, VALID_INPUT[t.name], ctx);
      expect(out.kind).toBe("ok");
    });
  }

  it("실행 중 예외는 error로 변환된다 (모델에게 원인 전달)", async () => {
    const ctx = mockCtx();
    ctx.findUsers = vi.fn(async () => {
      throw new Error("Graph 권한 부족");
    });
    const out = await executeTool("find_users", { query: "김" }, ctx);
    expect(out).toEqual({ kind: "error", message: "Graph 권한 부족" });
  });
});
