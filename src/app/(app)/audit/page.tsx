import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { requireRole } from "@/lib/auth-helpers";
import { formatDateTimeKst } from "@/lib/format";
import { Badge, PageHeader, TabLink } from "@/components/ui";

export const metadata = { title: "감사 로그" };

const ACTOR_LABEL = { user: "사용자", assistant: "AI" } as const;

// 필터 탭 (B11) — actorType 기준. href는 검색어를 보존한다
const ACTOR_TABS = [
  { key: undefined, label: "전체" },
  { key: "user", label: "사용자" },
  { key: "assistant", label: "AI" },
] as const;

function tabHref(actor: string | undefined, q: string): string {
  const params = new URLSearchParams();
  if (actor) params.set("actor", actor);
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `/audit?${qs}` : "/audit";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; q?: string }>;
}) {
  await requireRole("admin");

  const { actor: actorParam, q: qParam } = await searchParams;
  const actor =
    actorParam === "user" || actorParam === "assistant" ? actorParam : undefined;
  const q = (qParam ?? "").trim().slice(0, 100);

  // ilike는 파라미터 바인딩으로 안전 — %·_는 와일드카드로 동작(허용)
  const conditions: SQL[] = [];
  if (actor) conditions.push(eq(auditLogs.actorType, actor));
  if (q) {
    conditions.push(
      or(
        ilike(auditLogs.action, `%${q}%`),
        ilike(auditLogs.targetId, `%${q}%`),
        ilike(users.name, `%${q}%`),
      )!,
    );
  }

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorType: auditLogs.actorType,
      actorName: users.name,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      detail: auditLogs.detail,
      success: auditLogs.success,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    // seq = 삽입 순서를 따르는 단조 순번 — 동시 쓰기에서도 순서가 안정적
    .orderBy(desc(auditLogs.seq))
    .limit(100);

  return (
    <div className="max-w-[1140px]">
      <PageHeader
        title="감사 로그"
        subtitle="모든 관리 쓰기 액션의 기록 — 최근 100건 · KST · 삽입 순번(seq) 기준"
        actions={
          <>
            <nav className="flex gap-1">
              {ACTOR_TABS.map((t) => (
                <TabLink
                  key={t.label}
                  href={tabHref(t.key, q)}
                  active={actor === t.key}
                >
                  {t.label}
                </TabLink>
              ))}
            </nav>
            {/* GET 폼 — 서버 컴포넌트에서 JS 없이 검색 제출 */}
            <form action="/audit" className="flex">
              {actor && <input type="hidden" name="actor" value={actor} />}
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="액션, 대상, 실행자 검색"
                className="w-52 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none placeholder:text-ink-muted focus:border-line-strong"
              />
            </form>
          </>
        }
      />
      <div className="mt-5 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-medium text-ink-muted">
              <th className="px-4 py-2 font-medium">시각 (KST)</th>
              <th className="px-4 py-2 font-medium">실행자</th>
              <th className="px-4 py-2 font-medium">액션</th>
              <th className="px-4 py-2 font-medium">상세</th>
              <th className="px-4 py-2 text-center font-medium">결과</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-fill align-top">
                <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-sub">
                  {formatDateTimeKst(r.createdAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-2">
                  <span className="font-medium">{r.actorName ?? "—"}</span>
                  <Badge
                    tone={r.actorType === "assistant" ? "orange" : "neutral"}
                    className="ml-1.5"
                  >
                    {ACTOR_LABEL[r.actorType]}
                  </Badge>
                </td>
                <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                <td className="max-w-xs px-4 py-2 font-mono text-[11px] text-ink-secondary">
                  <span className="break-all">
                    {r.detail ? JSON.stringify(r.detail) : "—"}
                  </span>
                </td>
                <td className="px-4 py-2 text-center font-bold">
                  {r.success ? (
                    <span className="text-emerald-600">✓</span>
                  ) : (
                    <span className="text-red-600">✕</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                  {actor || q ? "조건에 맞는 기록이 없습니다" : "기록이 없습니다"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-xs text-ink-muted">
        AI 실행 건은 승인 게이트를 거치며 승인자(approvedBy)가 함께 기록됩니다 ·
        되돌리기 어려운 액션은 승인 없이 실행되지 않습니다
      </p>
    </div>
  );
}
