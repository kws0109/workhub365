import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { assertRole } from "@/lib/auth-helpers";
import * as graphUsers from "@/lib/graph/users";
import {
  generateTempPassword,
  offboardSteps,
  onboardSteps,
  runPipeline,
  type LifecycleOps,
  type OffboardCtx,
  type OnboardCtx,
  type OnboardParams,
  type StepEvent,
} from "@/lib/lifecycle";

// 파이프라인 단계 이벤트를 NDJSON으로 스트리밍한다.
// 요청 형식:
//  { kind: "onboard", params: OnboardParams, resumeFrom?, createdUserId? }
//  { kind: "offboard", targetUserId, resumeFrom? }
//
// 원칙: 감사 로그 기록이 클라이언트 전송보다 먼저다. 클라이언트가 끊겨도
// 파이프라인과 감사 기록은 계속된다 (파괴적 작업이 브라우저 생존에 의존하면 안 됨).

const ops: LifecycleOps = {
  createUser: graphUsers.createUser,
  setUserLicenses: graphUsers.setUserLicenses,
  addUserToGroup: graphUsers.addUserToGroup,
  setAccountEnabled: graphUsers.setAccountEnabled,
  revokeSignInSessions: graphUsers.revokeSignInSessions,
  getUserLicenseSkuIds: graphUsers.getUserLicenseSkuIds,
  getUserGroups: graphUsers.getUserGroupIds,
  removeUserFromGroup: graphUsers.removeUserFromGroup,
};

const NICKNAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;

function parseOnboardParams(raw: unknown): OnboardParams {
  const p = raw as Partial<OnboardParams> | undefined;
  if (
    !p ||
    typeof p.displayName !== "string" ||
    !p.displayName.trim() ||
    typeof p.mailNickname !== "string" ||
    !NICKNAME_RE.test(p.mailNickname) ||
    typeof p.department !== "string" ||
    typeof p.jobTitle !== "string" ||
    !Array.isArray(p.skuIds) ||
    !p.skuIds.every((s) => typeof s === "string") ||
    !Array.isArray(p.groupIds) ||
    !p.groupIds.every((s) => typeof s === "string")
  ) {
    throw new Error("INVALID_INPUT");
  }
  return {
    displayName: p.displayName.trim(),
    mailNickname: p.mailNickname,
    department: p.department.trim(),
    jobTitle: p.jobTitle.trim(),
    skuIds: p.skuIds,
    groupIds: p.groupIds,
  };
}

/** 단계별 감사 로그 상세 — 복구 가능하도록 무엇이 변했는지 기록한다 */
function auditDetail(
  e: StepEvent,
  kind: "onboard" | "offboard",
  ctx: OnboardCtx | OffboardCtx,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    label: e.label,
    message: e.message ?? null,
  };
  if (kind === "onboard") {
    const c = ctx as OnboardCtx;
    if (e.key === "assign_license") base.skuIds = c.params.skuIds;
    if (e.key === "add_groups") base.groupIds = c.params.groupIds;
  } else {
    const c = ctx as OffboardCtx;
    if (e.key === "reclaim_licenses") base.skuIds = c.reclaimedSkuIds ?? [];
    if (e.key === "remove_groups") base.groups = c.removedGroups ?? [];
  }
  return base;
}

export async function POST(req: Request) {
  let session;
  try {
    session = await assertRole("admin");
  } catch {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const actorId = session.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const kind = body.kind;
  if (kind !== "onboard" && kind !== "offboard") {
    return Response.json({ error: "INVALID_KIND" }, { status: 400 });
  }
  const resumeFrom =
    typeof body.resumeFrom === "string" ? body.resumeFrom : undefined;

  // 알 수 없는 재개 지점은 스트림을 열기 전에 거부 (false-success 방지)
  const stepKeys = (kind === "onboard" ? onboardSteps() : offboardSteps()).map(
    (s) => s.key,
  );
  if (resumeFrom && !stepKeys.includes(resumeFrom)) {
    return Response.json({ error: "INVALID_RESUME" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let clientGone = false;

  const stream = new ReadableStream({
    async start(controller) {
      // 클라이언트가 끊겨도 파이프라인은 계속 — 전송만 중단한다
      const send = (obj: unknown) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          clientGone = true;
        }
      };
      const close = () => {
        if (clientGone) return;
        try {
          controller.close();
        } catch {
          /* 이미 닫힘 */
        }
      };

      // 감사 로그 실패는 파이프라인 실패로 오인시키지 않는다 — 별도 경고로 알린다
      const audit = async (
        e: StepEvent,
        targetId: string | null,
        ctx: OnboardCtx | OffboardCtx,
      ) => {
        if (e.status !== "ok" && e.status !== "error") return;
        try {
          await db.insert(auditLogs).values({
            actorId,
            actorType: "user",
            action: `${kind}.${e.key}`,
            targetType: "entra_user",
            targetId,
            detail: auditDetail(e, kind, ctx),
            success: e.status === "ok",
          });
        } catch (auditError) {
          console.error("audit_logs 기록 실패:", auditError);
          send({ warning: "AUDIT_WRITE_FAILED", step: e.key });
        }
      };

      try {
        if (kind === "onboard") {
          const params = parseOnboardParams(body.params);
          const domain = await graphUsers.getDefaultDomain();
          const expectedUpn = `${params.mailNickname}@${domain}`.toLowerCase();

          // 재개 시 클라이언트가 돌려준 createdUserId는 반드시 검증 —
          // 임의 디렉터리 개체에 라이선스/그룹을 부여하는 통로가 되면 안 된다
          let createdUserId: string | undefined;
          if (typeof body.createdUserId === "string" && body.createdUserId) {
            const target = await graphUsers.getUserBasic(body.createdUserId);
            if (
              !target ||
              target.userPrincipalName.toLowerCase() !== expectedUpn
            ) {
              send({ done: true, ok: false, error: "재개 대상 검증 실패" });
              close();
              return;
            }
            createdUserId = target.id;
          }

          const tempPassword = generateTempPassword(randomBytes);
          const ctx: OnboardCtx = {
            params,
            domain,
            tempPassword,
            createdUserId,
            ops,
          };

          let createdThisRun = false;
          const result = await runPipeline(
            onboardSteps(),
            ctx,
            async (e) => {
              if (e.key === "create_user" && e.status === "ok") {
                createdThisRun = true;
              }
              await audit(e, ctx.createdUserId ?? null, ctx);
              send(
                e.key === "create_user" && e.status === "ok"
                  ? { ...e, context: { createdUserId: ctx.createdUserId! } }
                  : e,
              );
            },
            resumeFrom,
          );

          send({
            done: true,
            ok: result.ok,
            failedStep: result.failedStep ?? null,
            // 이 요청에서 계정이 실제로 생성됐다면 성공 여부와 무관하게
            // 비밀번호를 반드시 전달한다 — 유실되면 관리자가 복구할 방법이 없다
            tempPassword: createdThisRun ? tempPassword : undefined,
            upn: `${params.mailNickname}@${domain}`,
          });
        } else {
          const targetUserId = body.targetUserId;
          if (typeof targetUserId !== "string" || !targetUserId) {
            send({ done: true, ok: false, error: "INVALID_TARGET" });
            close();
            return;
          }

          // 자기 자신 오프보딩 차단 — 관리자 잠금 사고 방지 (GUID 대소문자 무시)
          const me = await db.query.users.findFirst({
            where: eq(users.id, actorId),
          });
          if (
            me?.entraId &&
            me.entraId.toLowerCase() === targetUserId.toLowerCase()
          ) {
            send({
              done: true,
              ok: false,
              error: "자기 자신은 오프보딩할 수 없습니다",
            });
            close();
            return;
          }

          const ctx: OffboardCtx = { targetUserId, ops };
          const result = await runPipeline(
            offboardSteps(),
            ctx,
            async (e) => {
              await audit(e, targetUserId, ctx);
              send(e);
            },
            resumeFrom,
          );
          send({
            done: true,
            ok: result.ok,
            failedStep: result.failedStep ?? null,
          });
        }
      } catch (e) {
        send({
          done: true,
          ok: false,
          error: e instanceof Error ? e.message : "UNKNOWN",
        });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
