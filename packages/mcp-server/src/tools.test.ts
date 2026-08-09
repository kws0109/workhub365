import { describe, expect, it, vi } from "vitest";
import {
  TOOLS,
  executeTool,
  getTool,
  roleAtLeast,
  toolInputJsonSchema,
  toolsForRole,
} from "./tools";
import type { ActorContext, Role, ToolContext } from "./types";

// 승인 게이트 시나리오 테스트 (R5.3 수용 기준):
// "승인 없이 파괴 액션이 실행되는 경로가 존재하지 않음"을 구조적으로 검증한다.
// R5.1 개정: 역할 게이트(minRole) — employee에게 admin 도구가 노출·실행되지 않고,
// 본인 조회 도구는 actor 주입으로만 동작함(타인 조회 불가)도 함께 감시한다.

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
    getMyLeaveStatus: vi.fn(async () => ({
      remainingDays: 12.5,
      recentRequests: [],
    })),
    getMyWeekAttendance: vi.fn(async () => ({
      weekStart: "2026-08-03",
      days: [],
      weeklyMinutes: 0,
      remainingMinutesTo52h: 52 * 60,
      level: "ok" as const,
    })),
    getMyProposals: vi.fn(async () => ({ recent: [], myTurnCount: 0 })),
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

const ADMIN: ActorContext = { userId: "admin-user-id", role: "admin" };
const EMPLOYEE: ActorContext = { userId: "employee-user-id", role: "employee" };

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
  get_my_leave_status: {},
  get_my_week_attendance: {},
  get_my_proposals: {},
};

/** 변경형 도구가 실행 시 호출하는 ctx 메서드 매핑 */
const MUTATION_CTX_METHOD: Record<string, keyof ToolContext> = {
  create_user: "createUser",
  block_user: "blockUser",
  revoke_user_sessions: "revokeUserSessions",
  remove_user_license: "removeUserLicense",
  remove_user_from_group: "removeUserFromGroup",
};

/** 본인 조회 도구(employee 개방)가 호출하는 ctx 메서드 매핑 */
const SELF_CTX_METHOD: Record<string, keyof ToolContext> = {
  get_my_leave_status: "getMyLeaveStatus",
  get_my_week_attendance: "getMyWeekAttendance",
  get_my_proposals: "getMyProposals",
};

const mutationTools = TOOLS.filter((t) => t.requiresApproval);
const readTools = TOOLS.filter((t) => !t.requiresApproval);
const selfTools = TOOLS.filter((t) => t.requiresActor);

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
    // 여기서 잡힌다 — R5.3의 나머지 절반. 본인 조회 도구도 포함되도록 admin
    // actor를 주입한다(admin은 모든 minRole을 통과)
    for (const t of readTools) {
      const ctx = mockCtx();
      const out = await executeTool(t.name, VALID_INPUT[t.name], ctx, {
        actor: ADMIN,
      });
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
      const out = await executeTool(t.name, VALID_INPUT[t.name], ctx, {
        actor: ADMIN,
      });
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

describe("역할 서열·도구 노출 필터 (R5.1 개정 — 순수 로직)", () => {
  it("roleAtLeast: employee < manager < admin 서열을 따른다", () => {
    const roles: Role[] = ["employee", "manager", "admin"];
    const expected: Record<Role, Record<Role, boolean>> = {
      employee: { employee: true, manager: false, admin: false },
      manager: { employee: true, manager: true, admin: false },
      admin: { employee: true, manager: true, admin: true },
    };
    for (const role of roles) {
      for (const min of roles) {
        expect(roleAtLeast(role, min), `${role} vs min ${min}`).toBe(
          expected[role][min],
        );
      }
    }
  });

  it("employee/manager에게는 본인 조회 3종만 노출되고 admin 도구는 노출되지 않는다", () => {
    for (const role of ["employee", "manager"] as const) {
      const names = toolsForRole(role).map((t) => t.name);
      expect(names.sort()).toEqual(
        ["get_my_leave_status", "get_my_proposals", "get_my_week_attendance"],
      );
    }
  });

  it("admin에게는 전체 도구가 노출된다", () => {
    expect(toolsForRole("admin").length).toBe(TOOLS.length);
  });

  it("기존 도구 10종은 조회형 포함 전부 admin 전용이다 (전체 조회·관리형)", () => {
    const legacy = TOOLS.filter((t) => !t.requiresActor);
    expect(legacy.length).toBe(10);
    for (const t of legacy) {
      expect(t.minRole, `${t.name}의 minRole`).toBe("admin");
    }
  });

  it("변경형 도구는 모두 admin 전용이다 — employee/manager는 요청 자체가 불가", () => {
    for (const t of mutationTools) {
      expect(t.minRole, `${t.name}의 minRole`).toBe("admin");
    }
  });
});

describe("executeTool — 역할 게이트 2차 (목록 필터 우회 차단)", () => {
  it("employee가 admin 도구를 직접 호출하면 권한 부족 오류로 차단되고 어떤 ctx 메서드도 호출되지 않는다", async () => {
    const adminOnly = TOOLS.filter((t) => t.minRole === "admin");
    for (const t of adminOnly) {
      const ctx = mockCtx();
      const out = await executeTool(t.name, VALID_INPUT[t.name], ctx, {
        actor: EMPLOYEE,
      });
      expect(out.kind, `${t.name}이(가) employee에게 차단되지 않음`).toBe("error");
      if (out.kind === "error") expect(out.message).toContain("권한 부족");
      for (const fn of Object.values(ctx)) {
        expect(fn, `${t.name} 차단 경로에서 ctx 호출됨`).not.toHaveBeenCalled();
      }
    }
  });

  it("employee가 변경형 도구를 호출해도 approval_required가 아닌 권한 부족이다 (승인 요청 생성 불가)", async () => {
    const out = await executeTool(
      "block_user",
      VALID_INPUT.block_user,
      mockCtx(),
      { actor: EMPLOYEE },
    );
    expect(out.kind).toBe("error");
  });

  it("역할 게이트가 있어도 변경형은 여전히 approval_required다 — admin actor + 승인 없음", async () => {
    // 역할 추가가 승인 게이트 불변식(CLAUDE.md 3번)을 약화시키지 않는지 감시
    for (const t of mutationTools) {
      const ctx = mockCtx();
      const out = await executeTool(t.name, VALID_INPUT[t.name], ctx, {
        actor: ADMIN,
      });
      expect(out.kind, `${t.name} 승인 게이트 소실`).toBe("approval_required");
      for (const fn of Object.values(ctx)) {
        expect(fn).not.toHaveBeenCalled();
      }
    }
  });
});

describe("본인 조회 도구 (employee 개방 — actor 주입)", () => {
  it("신설 3종이 존재하고 조회 전용(requiresApproval=false)·minRole employee다", () => {
    expect(selfTools.map((t) => t.name).sort()).toEqual(
      ["get_my_leave_status", "get_my_proposals", "get_my_week_attendance"],
    );
    for (const t of selfTools) {
      expect(t.requiresApproval, `${t.name}은 승인 불필요여야 함`).toBe(false);
      expect(t.minRole, `${t.name}의 minRole`).toBe("employee");
    }
  });

  it("입력 스키마에 userId류 필드가 아예 없다 — 타인 조회 경로가 구조적으로 없음", () => {
    for (const t of selfTools) {
      const schema = toolInputJsonSchema(t);
      const props = Object.keys(
        (schema.properties ?? {}) as Record<string, unknown>,
      );
      expect(props, `${t.name}의 입력 필드`).toEqual([]);
    }
  });

  it("employee actor로 실행 가능하며, 본인 조회 메서드에 actor userId만 전달되고 부수효과가 없다", async () => {
    for (const [toolName, method] of Object.entries(SELF_CTX_METHOD)) {
      const ctx = mockCtx();
      const out = await executeTool(toolName, {}, ctx, { actor: EMPLOYEE });
      expect(out.kind, `${toolName} 실행 실패`).toBe("ok");
      expect(ctx[method]).toHaveBeenCalledTimes(1);
      expect(ctx[method]).toHaveBeenCalledWith(EMPLOYEE.userId);
      // 변경형 메서드는 물론, 다른 어떤 ctx 메서드도 호출되지 않는다
      for (const [key, fn] of Object.entries(ctx)) {
        if (key === method) continue;
        expect(fn, `${toolName}이(가) ${key}를 호출함`).not.toHaveBeenCalled();
      }
    }
  });

  it("도구 입력으로 userId를 넘겨도 무시된다 — 스키마 외 필드는 결과에 영향 없음", async () => {
    const ctx = mockCtx();
    const out = await executeTool(
      "get_my_leave_status",
      { userId: "someone-else" },
      ctx,
      { actor: EMPLOYEE },
    );
    expect(out.kind).toBe("ok");
    expect(ctx.getMyLeaveStatus).toHaveBeenCalledWith(EMPLOYEE.userId);
  });

  it("actor 없이 호출되면(stdio 경로) 실행하지 않고 actor_required로 강등된다", async () => {
    for (const t of selfTools) {
      const ctx = mockCtx();
      const out = await executeTool(t.name, {}, ctx);
      expect(out).toEqual({ kind: "actor_required", toolName: t.name });
      for (const fn of Object.values(ctx)) {
        expect(fn).not.toHaveBeenCalled();
      }
    }
  });
});
