import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users as dbUsers } from "@/db/schema";
import { requireRole } from "@/lib/auth-helpers";
import { formatDateTimeKst } from "@/lib/format";
import { GraphError } from "@/lib/graph/client";
import { getSubscribedSkus } from "@/lib/graph/licenses";
import {
  getDefaultDomain,
  getDirectoryUsers,
  getGroups,
} from "@/lib/graph/users";
import { buildPriceMap } from "@/lib/sku-prices";
import { Badge, Card, PageHeader, SourceChip } from "@/components/ui";
import { OnboardWizard } from "@/components/lifecycle/onboard-wizard";
import { OffboardWizard } from "@/components/lifecycle/offboard-wizard";

export const metadata = { title: "온보딩/오프보딩" };

type PageData = {
  domain: string;
  groups: { id: string; displayName: string }[];
  skuOptions: { skuId: string; label: string; remaining: number }[];
  offboardTargets: {
    id: string;
    displayName: string;
    userPrincipalName: string;
    department: string | null;
    licenseCount: number;
  }[];
};

// 데이터 수집만 try/catch로 감싼다 — JSX를 try 안에서 만들면
// 렌더링 오류가 catch로 잡히는 것처럼 보이지만 실제로는 잡히지 않는다
async function loadPageData(): Promise<
  { ok: true; data: PageData } | { ok: false; error: string }
> {
  try {
    const [skus, groups, users, domain] = await Promise.all([
      getSubscribedSkus(),
      getGroups(),
      getDirectoryUsers(),
      getDefaultDomain(),
    ]);
    const prices = await buildPriceMap(skus);

    const skuOptions = skus.map((s) => ({
      skuId: s.skuId,
      label: prices.get(s.skuId)?.displayName ?? s.skuPartNumber,
      remaining: Math.max(
        0,
        s.prepaidUnits.enabled + s.prepaidUnits.warning - s.consumedUnits,
      ),
    }));

    // 비활성 계정도 포함 — 중간 실패한 오프보딩(차단됨, 회수 미완)을 재개할 경로가 필요
    const offboardTargets = users
      .map((u) => ({
        id: u.id,
        displayName: u.accountEnabled
          ? u.displayName
          : `${u.displayName} (비활성)`,
        userPrincipalName: u.userPrincipalName,
        department: u.department ?? null,
        licenseCount: u.assignedLicenses.length,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));

    return { ok: true, data: { domain, groups, skuOptions, offboardTargets } };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof GraphError ? `${e.code}: ${e.message}` : "알 수 없는 오류",
    };
  }
}

// ── B14: 최근 실행 이력 — audit_logs 파생 조회 (별도 테이블 없음) ──────────

// 온보딩·오프보딩이 실제로 남기는 액션명.
// 화면 파이프라인(/api/lifecycle)은 `${kind}.${stepKey}`, AI 어시스턴트는
// 승인 게이트 통과 실행이 `assistant.tool.${toolName}`으로 기록된다.
const HISTORY_ACTIONS = [
  "onboard.create_user",
  "onboard.assign_license",
  "onboard.add_groups",
  "offboard.block_signin",
  "offboard.revoke_sessions",
  "offboard.reclaim_licenses",
  "offboard.remove_groups",
  "assistant.tool.create_user",
  "assistant.tool.block_user",
  "assistant.tool.revoke_user_sessions",
  "assistant.tool.remove_user_license",
  "assistant.tool.remove_user_from_group",
];

const ASSISTANT_TOOL_KIND: Record<string, string> = {
  "assistant.tool.create_user": "온보딩",
  "assistant.tool.block_user": "오프보딩",
  "assistant.tool.revoke_user_sessions": "오프보딩",
  "assistant.tool.remove_user_license": "오프보딩",
  "assistant.tool.remove_user_from_group": "오프보딩",
};

type HistoryRow = {
  id: string;
  action: string;
  actorType: "user" | "assistant";
  actorName: string | null;
  targetId: string | null;
  detail: unknown;
  success: boolean;
  createdAt: Date;
};

/** 이력 조회 실패가 위저드 사용을 막지 않도록 별도 폴백 (null = 조회 실패) */
async function loadHistory(): Promise<HistoryRow[] | null> {
  try {
    return await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        actorType: auditLogs.actorType,
        actorName: dbUsers.name,
        targetId: auditLogs.targetId,
        detail: auditLogs.detail,
        success: auditLogs.success,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(dbUsers, eq(auditLogs.actorId, dbUsers.id))
      .where(inArray(auditLogs.action, HISTORY_ACTIONS))
      .orderBy(desc(auditLogs.seq))
      .limit(5);
  } catch (e) {
    console.error("최근 실행 이력 조회 실패:", e);
    return null;
  }
}

const GUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** GUID를 앞 8자로 축약 — 이력 행 가독성 (전체 값은 감사 로그 화면에서) */
function shortenGuids(s: string): string {
  return s.replace(GUID_RE, (m) => `${m.slice(0, 8)}…`);
}

/** 유형 · 단계/도구 라벨 — 대상이 읽을 수 있는 값이면 병기 */
function historyTitle(r: HistoryRow): string {
  const d = (r.detail ?? {}) as Record<string, unknown>;
  if (r.action.startsWith("assistant.tool.")) {
    const kind = ASSISTANT_TOOL_KIND[r.action] ?? "AI 실행";
    // detail.summary가 도구 라벨 + 대상을 이미 담고 있다 (예: "계정 생성: 김철수 (chulsoo.kim)")
    const summary =
      typeof d.summary === "string" ? shortenGuids(d.summary) : r.action;
    return `${kind} · ${summary}`;
  }
  const kind = r.action.startsWith("onboard.") ? "온보딩" : "오프보딩";
  const label = typeof d.label === "string" ? d.label : r.action;
  // onboard.create_user 성공 행의 message = UPN — 가장 읽기 좋은 대상 표기
  const target =
    r.action === "onboard.create_user" &&
    r.success &&
    typeof d.message === "string" &&
    d.message
      ? d.message
      : r.targetId
        ? shortenGuids(r.targetId)
        : null;
  return target ? `${kind} · ${label} — ${target}` : `${kind} · ${label}`;
}

/** 실행자 표기 — AI 실행 행의 actorId는 승인 게이트를 통과시킨 관리자다 */
function historyActor(r: HistoryRow): string {
  const name = r.actorName ?? "—";
  return r.actorType === "assistant" ? `AI 어시스턴트 (승인: ${name})` : name;
}

export default async function LifecyclePage() {
  await requireRole("admin");
  const [result, history] = await Promise.all([loadPageData(), loadHistory()]);

  if (!result.ok) {
    return (
      <div className="max-w-[920px]">
        <PageHeader
          title="온보딩 / 오프보딩"
          subtitle={<SourceChip brand="graph">Graph 파이프라인</SourceChip>}
        />
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p className="font-semibold">Graph API 조회에 실패했습니다</p>
          <p className="mt-1">{result.error}</p>
        </div>
      </div>
    );
  }

  const { domain, groups, skuOptions, offboardTargets } = result.data;
  return (
    <div className="max-w-[920px]">
      <PageHeader
        title="온보딩 / 오프보딩"
        subtitle={
          <>
            <SourceChip brand="graph">Graph 파이프라인</SourceChip>
            <span>
              계정 생성부터 퇴사 정리까지 — 단계별 자동화, 실패 시 해당
              단계부터 재시도
            </span>
          </>
        }
      />
      <div className="mt-5 space-y-4">
        <OnboardWizard
          domain={domain}
          skuOptions={skuOptions}
          groupOptions={groups}
        />
        <OffboardWizard users={offboardTargets} />

        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">최근 실행 이력</h2>
          {history === null ? (
            <p className="mt-3 text-xs text-ink-muted">
              이력을 불러오지 못했습니다 — 감사 로그 화면에서 확인하세요
            </p>
          ) : history.length === 0 ? (
            <p className="mt-3 text-xs text-ink-muted">
              아직 실행 이력이 없습니다
            </p>
          ) : (
            <div className="mt-1.5 flex flex-col">
              {history.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 border-t border-fill py-2 text-[13px]"
                >
                  <span className="min-w-0">
                    <p className="truncate font-medium">{historyTitle(r)}</p>
                    <p className="mt-px text-xs text-ink-muted">
                      {formatDateTimeKst(r.createdAt)} · {historyActor(r)}
                    </p>
                  </span>
                  <Badge
                    tone={r.success ? "success" : "danger"}
                    className="shrink-0"
                  >
                    {r.success ? "성공" : "실패"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
