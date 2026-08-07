// 온보딩/오프보딩 파이프라인 — 단계는 데이터, 실행기는 이벤트 방출.
// Graph 호출은 ops 인터페이스로 주입받아 파이프라인 자체를 단위 테스트할 수 있게 한다.

export type StepStatus = "running" | "ok" | "error" | "skipped";

export type StepEvent = {
  key: string;
  label: string;
  status: StepStatus;
  message?: string;
  /** 이후 단계·재시도에 필요한 축적 컨텍스트 (예: 생성된 userId) */
  context?: Record<string, string>;
};

export type Step<Ctx> = {
  key: string;
  label: string;
  run: (ctx: Ctx) => Promise<string | void>; // 반환 문자열은 성공 메시지
};

/**
 * 파이프라인 실행. resumeFrom 이전 단계는 skipped로 방출한다(재시도 경로).
 * 단계 실패 시 이후 단계를 실행하지 않고 멈춘다 — 실패를 삼키지 않는다.
 */
export async function runPipeline<Ctx>(
  steps: Step<Ctx>[],
  ctx: Ctx,
  emit: (e: StepEvent) => void | Promise<void>,
  resumeFrom?: string,
): Promise<{ ok: boolean; failedStep?: string }> {
  // 알 수 없는 재개 지점 = 전 단계 skip 후 false-success — 반드시 거부한다
  if (resumeFrom && !steps.some((s) => s.key === resumeFrom)) {
    throw new Error(`UNKNOWN_RESUME_STEP: ${resumeFrom}`);
  }
  let started = !resumeFrom;
  for (const step of steps) {
    if (!started) {
      if (step.key === resumeFrom) {
        started = true;
      } else {
        await emit({ key: step.key, label: step.label, status: "skipped" });
        continue;
      }
    }
    await emit({ key: step.key, label: step.label, status: "running" });
    try {
      const message = await step.run(ctx);
      await emit({
        key: step.key,
        label: step.label,
        status: "ok",
        message: message ?? undefined,
      });
    } catch (e) {
      await emit({
        key: step.key,
        label: step.label,
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
      return { ok: false, failedStep: step.key };
    }
  }
  return { ok: true };
}

// ── 온보딩 ──────────────────────────────────────────────

export type OnboardParams = {
  displayName: string;
  mailNickname: string;
  department: string;
  jobTitle: string;
  skuIds: string[];
  groupIds: string[];
};

export type OnboardCtx = {
  params: OnboardParams;
  domain: string;
  tempPassword: string;
  /** 1단계에서 채워짐. 재시도 시 클라이언트가 되돌려준다 */
  createdUserId?: string;
  ops: LifecycleOps;
};

export type OffboardCtx = {
  targetUserId: string;
  ops: LifecycleOps;
  /** 복구 가능성을 위해 감사 로그에 남길 상세 — 단계 실행 중 채워진다 */
  reclaimedSkuIds?: string[];
  removedGroups?: { id: string; displayName: string }[];
};

/** Graph 의존성 주입 지점 — 테스트에서 mock으로 대체 */
export type LifecycleOps = {
  createUser: (input: {
    displayName: string;
    mailNickname: string;
    userPrincipalName: string;
    department: string;
    jobTitle: string;
    tempPassword: string;
  }) => Promise<{ id: string }>;
  setUserLicenses: (
    userId: string,
    add: string[],
    remove: string[],
  ) => Promise<void>;
  addUserToGroup: (userId: string, groupId: string) => Promise<void>;
  setAccountEnabled: (userId: string, enabled: boolean) => Promise<void>;
  revokeSignInSessions: (userId: string) => Promise<void>;
  getUserLicenseSkuIds: (userId: string) => Promise<string[]>;
  getUserGroups: (
    userId: string,
  ) => Promise<{ id: string; displayName: string; dynamic: boolean }[]>;
  removeUserFromGroup: (userId: string, groupId: string) => Promise<void>;
};

/** Graph "이미 멤버" 오류인지 — add_groups 재시도 멱등성을 위해 무시한다 */
function isAlreadyMemberError(e: unknown): boolean {
  return e instanceof Error && /already exist/i.test(e.message);
}

export function onboardSteps(): Step<OnboardCtx>[] {
  return [
    {
      key: "create_user",
      label: "계정 생성",
      run: async (ctx) => {
        const upn = `${ctx.params.mailNickname}@${ctx.domain}`;
        const created = await ctx.ops.createUser({
          displayName: ctx.params.displayName,
          mailNickname: ctx.params.mailNickname,
          userPrincipalName: upn,
          department: ctx.params.department,
          jobTitle: ctx.params.jobTitle,
          tempPassword: ctx.tempPassword,
        });
        ctx.createdUserId = created.id;
        return upn;
      },
    },
    {
      key: "assign_license",
      label: "라이선스 할당",
      run: async (ctx) => {
        if (!ctx.createdUserId) throw new Error("생성된 사용자 ID가 없습니다");
        if (ctx.params.skuIds.length === 0) return "할당할 라이선스 없음";
        await ctx.ops.setUserLicenses(ctx.createdUserId, ctx.params.skuIds, []);
        return `${ctx.params.skuIds.length}개 할당`;
      },
    },
    {
      key: "add_groups",
      label: "그룹 배정",
      run: async (ctx) => {
        if (!ctx.createdUserId) throw new Error("생성된 사용자 ID가 없습니다");
        let added = 0;
        for (const groupId of ctx.params.groupIds) {
          try {
            await ctx.ops.addUserToGroup(ctx.createdUserId, groupId);
            added++;
          } catch (e) {
            // 재시도 시 이미 배정된 그룹은 성공으로 취급 (멱등)
            if (isAlreadyMemberError(e)) added++;
            else throw e;
          }
        }
        return ctx.params.groupIds.length === 0
          ? "배정할 그룹 없음"
          : `${added}개 그룹`;
      },
    },
  ];
}

export function offboardSteps(): Step<OffboardCtx>[] {
  return [
    {
      key: "block_signin",
      label: "로그인 차단",
      run: async (ctx) => {
        await ctx.ops.setAccountEnabled(ctx.targetUserId, false);
      },
    },
    {
      key: "revoke_sessions",
      label: "세션 철회",
      run: async (ctx) => {
        await ctx.ops.revokeSignInSessions(ctx.targetUserId);
      },
    },
    {
      key: "reclaim_licenses",
      label: "라이선스 회수",
      run: async (ctx) => {
        const skuIds = await ctx.ops.getUserLicenseSkuIds(ctx.targetUserId);
        if (skuIds.length === 0) return "회수할 라이선스 없음";
        await ctx.ops.setUserLicenses(ctx.targetUserId, [], skuIds);
        ctx.reclaimedSkuIds = skuIds; // 감사 로그용 — 어떤 SKU였는지 복구 가능하게
        return `${skuIds.length}개 회수`;
      },
    },
    {
      key: "remove_groups",
      label: "그룹 제거",
      run: async (ctx) => {
        const groups = await ctx.ops.getUserGroups(ctx.targetUserId);
        // 동적 멤버십 그룹은 멤버 제거 API가 항상 실패한다 — 건너뛰고 알린다
        const removable = groups.filter((g) => !g.dynamic);
        const skippedDynamic = groups.length - removable.length;
        const removed: { id: string; displayName: string }[] = [];
        const failed: string[] = [];
        for (const g of removable) {
          try {
            await ctx.ops.removeUserFromGroup(ctx.targetUserId, g.id);
            removed.push({ id: g.id, displayName: g.displayName });
          } catch {
            failed.push(g.displayName);
          }
        }
        ctx.removedGroups = removed; // 감사 로그용
        if (failed.length > 0) {
          throw new Error(
            `${removed.length}개 제거, 실패: ${failed.join(", ")}`,
          );
        }
        const parts = [
          removed.length > 0 ? `${removed.length}개 그룹에서 제거` : "소속 그룹 없음",
          skippedDynamic > 0 ? `동적 그룹 ${skippedDynamic}개 제외` : null,
        ].filter(Boolean);
        return parts.join(" · ");
      },
    },
  ];
}

/** Entra 복잡성 요건(대소문자+숫자+특수문자)을 충족하는 임시 비밀번호 */
export function generateTempPassword(randomBytes: (n: number) => Buffer): string {
  return `Wh${randomBytes(9).toString("base64url")}!3`;
}
