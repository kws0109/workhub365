import { z } from "zod";
import type { ActorContext, Role, ToolContext, ToolExecutionResult } from "./types";

// WorkHub365 AI 어시스턴트 도구의 단일 소스.
// - Next.js /api/assistant 루프가 in-process로 import
// - packages/mcp-server/src/stdio.ts가 MCP stdio 서버로도 노출
//
// 절대 불변식(CLAUDE.md 3번): requiresApproval 도구는 executeTool에
// approvalGranted가 명시되지 않는 한 절대 execute되지 않는다. 이 가드를
// 우회하는 실행 경로를 만들지 말 것 — 시나리오 테스트(tools.test.ts)가 감시한다.
//
// 역할 게이트(R5.1 개정): 모든 도구는 minRole(employee|manager|admin)을 가진다.
// 호스트는 ① 목록을 toolsForRole로 필터해 모델에 노출하고 ② executeTool에
// actor를 전달해 실행 직전에도 재검증한다(목록 필터를 우회한 tool_use 차단).

export type ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  inputSchema: S;
  requiresApproval: boolean;
  /** 이 도구를 사용할 수 있는 최소 역할. 전체 조회·관리형은 admin */
  minRole: Role;
  /**
   * true면 실행에 actor(로그인 사용자) 컨텍스트가 필수 — "내 정보" 조회 도구.
   * actor 없이 호출되면(stdio 등) 실행하지 않고 actor_required로 강등된다.
   */
  requiresActor?: boolean;
  /** 승인 카드·감사 로그용 한 줄 요약 */
  summarize: (input: z.infer<S>) => string;
  execute: (
    input: z.infer<S>,
    ctx: ToolContext,
    actor?: ActorContext,
  ) => Promise<unknown>;
};

function defineTool<S extends z.ZodTypeAny>(t: ToolDef<S>): ToolDef {
  return t as unknown as ToolDef;
}

// ── 역할 서열 비교 (순수 함수 — 단위 테스트 대상) ──────────────────────────

const ROLE_RANK: Record<Role, number> = { employee: 0, manager: 1, admin: 2 };

/** role이 minRole 이상인지 — employee < manager < admin */
export function roleAtLeast(role: Role, minRole: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/** 해당 역할이 사용할 수 있는 도구 목록 — 모델 노출 필터(게이트 1차) */
export function toolsForRole(role: Role): ToolDef[] {
  return TOOLS.filter((t) => roleAtLeast(role, t.minRole));
}

const userIdField = z
  .string()
  .min(10)
  .describe("대상 사용자의 Entra 객체 ID(GUID). find_users로 먼저 조회한다");

/**
 * 요약문에 넣는 GUID 축약(앞 8자). 이 패키지는 DB·Graph에 의존하지 않는 것이
 * 구조적 원칙이라 여기서는 이름을 알 수 없다 — 승인 카드에 실제 이름을 싣는 보강은
 * 해석 결과를 가진 호스트(src/lib/assistant/execute.ts)가 하고, 이 문자열은
 * 해석이 불가능한 경우(stdio 등)의 폴백으로 남는다.
 */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export const TOOLS: ToolDef[] = [
  // ── 조회형 (즉시 실행) ────────────────────────────────────────────────
  defineTool({
    name: "get_license_overview",
    description:
      "테넌트의 M365 라이선스 현황과 낭비 금액(원화)을 조회한다. SKU별 구매/할당/미할당 좌석, 미사용·차단 계정으로 인한 월 낭비 금액, 낭비 상위 사용자를 반환한다. '라이선스 낭비 얼마야', 'SKU 현황', '미사용 라이선스' 같은 질문에 사용한다.",
    inputSchema: z.object({
      inactiveDays: z
        .number()
        .int()
        .min(7)
        .max(365)
        .optional()
        .describe("휴면 판정 기준 일수 (기본 30일)"),
    }),
    requiresApproval: false,
    minRole: "admin", // 조회형이지만 테넌트 전체 조회라 admin 전용 (R5.1)
    summarize: (i) => `라이선스 현황 조회 (휴면 기준 ${i.inactiveDays ?? 30}일)`,
    execute: (i, ctx) => ctx.getLicenseOverview(i.inactiveDays ?? 30),
  }),
  defineTool({
    name: "find_users",
    description:
      "이름·이메일(UPN)·부서 키워드로 테넌트 사용자를 검색한다 (최대 20명). 다른 도구에 필요한 사용자 ID를 모를 때 반드시 먼저 호출한다.",
    inputSchema: z.object({
      query: z.string().min(1).describe("검색 키워드 (이름 일부, 이메일, 부서명)"),
    }),
    requiresApproval: false,
    minRole: "admin",
    summarize: (i) => `사용자 검색: "${i.query}"`,
    execute: async (i, ctx) => {
      const users = await ctx.findUsers(i.query);
      return { count: users.length, users: users.slice(0, 20) };
    },
  }),
  defineTool({
    name: "get_user_detail",
    description:
      "사용자 한 명의 상세 정보를 조회한다: 계정 활성 여부, 부서, 직함, 보유 라이선스, 소속 그룹(동적 그룹 여부 포함).",
    inputSchema: z.object({ userId: userIdField }),
    requiresApproval: false,
    minRole: "admin",
    summarize: (i) => `사용자 상세 조회: ${i.userId}`,
    execute: async (i, ctx) => {
      const detail = await ctx.getUserDetail(i.userId);
      return detail ?? { error: "해당 ID의 사용자를 찾을 수 없습니다" };
    },
  }),
  defineTool({
    name: "get_overtime_status",
    description:
      "이번 주(월요일 시작, 한국 표준시) 직원별 누적 근무시간과 주 52시간 위험 단계를 조회한다. level: ok(정상)/warn(48시간 초과)/over(52시간 초과). '이번 주 52시간 넘을 것 같은 사람' 같은 질문에 사용한다.",
    inputSchema: z.object({}),
    requiresApproval: false,
    minRole: "admin", // 전 직원 근무시간 조회 — 본인 것은 get_my_week_attendance
    summarize: () => "주간 근무시간(52시간) 현황 조회",
    execute: (_i, ctx) => ctx.getOvertimeStatus(),
  }),
  defineTool({
    name: "list_groups",
    description:
      "테넌트의 그룹 목록(id, 이름)을 조회한다. 그룹 제거·추가 대상의 그룹 ID가 필요할 때 호출한다.",
    inputSchema: z.object({}),
    requiresApproval: false,
    minRole: "admin",
    summarize: () => "그룹 목록 조회",
    execute: async (_i, ctx) => {
      const groups = await ctx.listGroups();
      return { count: groups.length, groups: groups.slice(0, 50) };
    },
  }),

  // ── 변경형 (승인 게이트 필수) ─────────────────────────────────────────
  defineTool({
    name: "create_user",
    description:
      "새 M365 계정을 생성한다 (임시 비밀번호 자동 발급, 최초 로그인 시 변경 강제). 선택적으로 라이선스 할당과 그룹 추가까지 수행한다. 되돌리기 어려운 작업이므로 관리자 승인 후 실행된다. mailNickname은 영문 소문자·숫자만 가능 — 한글 이름이면 사용자에게 영문 표기를 확인한다.",
    inputSchema: z.object({
      displayName: z.string().min(1).describe("표시 이름 (예: 김철수)"),
      mailNickname: z
        .string()
        .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/)
        .describe("이메일 로컬파트 (영문 소문자·숫자, 예: chulsoo.kim)"),
      department: z.string().optional().describe("부서명"),
      jobTitle: z.string().optional().describe("직함"),
      skuIds: z.array(z.string()).max(5).optional().describe("할당할 라이선스 skuId 목록"),
      groupIds: z.array(z.string()).max(10).optional().describe("추가할 그룹 id 목록"),
    }),
    requiresApproval: true,
    minRole: "admin",
    summarize: (i) =>
      `계정 생성 · ${i.displayName} (${i.mailNickname})` +
      (i.skuIds?.length ? ` — 라이선스 ${i.skuIds.length}개` : "") +
      (i.groupIds?.length ? ` · 그룹 ${i.groupIds.length}개` : ""),
    execute: (i, ctx) => ctx.createUser(i),
  }),
  defineTool({
    name: "block_user",
    description:
      "사용자 계정의 로그인을 차단한다(accountEnabled=false). 되돌리기 어려운 작업이므로 관리자 승인 후 실행된다.",
    inputSchema: z.object({ userId: userIdField }),
    requiresApproval: true,
    minRole: "admin",
    summarize: (i) => `계정 차단 · 사용자 ${shortId(i.userId)}`,
    execute: async (i, ctx) => {
      await ctx.blockUser(i.userId);
      return { blocked: true, userId: i.userId };
    },
  }),
  defineTool({
    name: "revoke_user_sessions",
    description:
      "사용자의 모든 로그인 세션(리프레시 토큰)을 즉시 철회한다. 관리자 승인 후 실행된다.",
    inputSchema: z.object({ userId: userIdField }),
    requiresApproval: true,
    minRole: "admin",
    summarize: (i) => `세션 철회 · 사용자 ${shortId(i.userId)}`,
    execute: async (i, ctx) => {
      await ctx.revokeUserSessions(i.userId);
      return { revoked: true, userId: i.userId };
    },
  }),
  defineTool({
    name: "remove_user_license",
    description:
      "사용자에게서 라이선스 1개를 회수한다. skuId는 get_user_detail 또는 get_license_overview로 확인한다. 관리자 승인 후 실행된다.",
    inputSchema: z.object({
      userId: userIdField,
      skuId: z.string().min(10).describe("회수할 라이선스의 skuId(GUID)"),
    }),
    requiresApproval: true,
    minRole: "admin",
    summarize: (i) =>
      `라이선스 회수 · 사용자 ${shortId(i.userId)} — SKU ${shortId(i.skuId)}`,
    execute: async (i, ctx) => {
      await ctx.removeUserLicense(i.userId, i.skuId);
      return { removed: true, userId: i.userId, skuId: i.skuId };
    },
  }),
  defineTool({
    name: "remove_user_from_group",
    description:
      "사용자를 그룹에서 제거한다. 동적 그룹은 제거할 수 없다. 관리자 승인 후 실행된다.",
    inputSchema: z.object({
      userId: userIdField,
      groupId: z.string().min(10).describe("제거할 그룹의 id(GUID)"),
    }),
    requiresApproval: true,
    minRole: "admin",
    summarize: (i) =>
      `그룹 제거 · 사용자 ${shortId(i.userId)} — 그룹 ${shortId(i.groupId)}`,
    execute: async (i, ctx) => {
      await ctx.removeUserFromGroup(i.userId, i.groupId);
      return { removed: true, userId: i.userId, groupId: i.groupId };
    },
  }),

  // ── 본인 조회형 (employee 개방 — R5.1 개정) ──────────────────────────────
  // 셋 다 조회 전용·승인 불필요. 대상 userId는 입력 스키마에 존재하지 않고
  // 서버가 주입한 actor에서만 온다 — 타인 정보 조회 경로가 구조적으로 없다.
  defineTool({
    name: "get_my_leave_status",
    description:
      "요청자 본인의 잔여 연차와 최근 휴가 신청 5건(유형·기간·일수·상태)을 조회한다. '내 연차 며칠 남았어', '내 휴가 신청 어떻게 됐어' 같은 질문에 사용한다.",
    inputSchema: z.object({}),
    requiresApproval: false,
    minRole: "employee",
    requiresActor: true,
    summarize: () => "내 휴가 현황 조회",
    execute: (_i, ctx, actor) => ctx.getMyLeaveStatus(actor!.userId),
  }),
  defineTool({
    name: "get_my_week_attendance",
    description:
      "요청자 본인의 이번 주(월요일 시작, 한국 표준시) 출퇴근 기록과 누적 근무시간, 주 52시간까지 남은 시간을 조회한다. '이번 주 내 근무시간', '52시간까지 얼마나 남았어' 같은 질문에 사용한다.",
    inputSchema: z.object({}),
    requiresApproval: false,
    minRole: "employee",
    requiresActor: true,
    summarize: () => "내 주간 근태 조회",
    execute: (_i, ctx, actor) => ctx.getMyWeekAttendance(actor!.userId),
  }),
  defineTool({
    name: "get_my_proposals",
    description:
      "요청자 본인이 기안한 최근 문서 5건(제목·템플릿·상태)과 현재 본인 차례인 결재 대기 건수를 조회한다. '내 기안 결재 어디까지 갔어', '내가 결재할 건 몇 개야' 같은 질문에 사용한다.",
    inputSchema: z.object({}),
    requiresApproval: false,
    minRole: "employee",
    requiresActor: true,
    summarize: () => "내 기안 현황 조회",
    execute: (_i, ctx, actor) => ctx.getMyProposals(actor!.userId),
  }),
];

export function getTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Claude API·MCP 양쪽에서 쓰는 JSON Schema 변환 ($schema 키 제거) */
export function toolInputJsonSchema(tool: ToolDef): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/**
 * 도구 실행의 유일한 진입점.
 * 변경형(requiresApproval) 도구는 approvalGranted 없이 호출되면 실행하지 않고
 * approval_required를 반환한다 — 승인 게이트 불변식의 구조적 강제.
 * approvalGranted는 승인 카드 서버 액션(pending→executing 클레임 성공 후)만 전달한다.
 *
 * actor가 주어지면 minRole 게이트를 실행 직전에 재검증한다(게이트 2차 —
 * 목록 필터를 우회한 tool_use도 여기서 차단). actor가 없는 호출(stdio)은
 * 역할 게이트를 건너뛰되, 본인 조회 도구는 actor_required로 강등된다.
 */
export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
  opts: { approvalGranted?: boolean; actor?: ActorContext } = {},
): Promise<ToolExecutionResult> {
  const tool = getTool(name);
  if (!tool) return { kind: "error", message: `알 수 없는 도구: ${name}` };

  if (opts.actor && !roleAtLeast(opts.actor.role, tool.minRole)) {
    return {
      kind: "error",
      message: `권한 부족: ${tool.name} 도구는 ${tool.minRole} 이상 역할만 사용할 수 있습니다`,
    };
  }

  const parsed = tool.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { kind: "error", message: `입력 검증 실패 — ${issues}` };
  }

  if (tool.requiresActor && !opts.actor) {
    return { kind: "actor_required", toolName: tool.name };
  }

  if (tool.requiresApproval && !opts.approvalGranted) {
    return {
      kind: "approval_required",
      toolName: tool.name,
      input: parsed.data,
      summary: tool.summarize(parsed.data),
    };
  }

  try {
    return { kind: "ok", result: await tool.execute(parsed.data, ctx, opts.actor) };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
