import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { requireRole } from "@/lib/auth-helpers";
import { formatDateTimeKst } from "@/lib/format";

export const metadata = { title: "감사 로그" };

const ACTOR_LABEL = { user: "사용자", assistant: "AI" } as const;

export default async function AuditPage() {
  await requireRole("admin");

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
    .orderBy(desc(auditLogs.createdAt))
    .limit(100);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight">감사 로그</h1>
      <p className="mt-1 text-xs text-zinc-400">
        모든 관리 쓰기 액션의 기록 (최근 100건)
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
              <th className="px-4 py-2 font-medium">시각 (KST)</th>
              <th className="px-4 py-2 font-medium">실행자</th>
              <th className="px-4 py-2 font-medium">액션</th>
              <th className="px-4 py-2 font-medium">상세</th>
              <th className="px-4 py-2 text-center font-medium">결과</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100 align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-2 text-zinc-600">
                  {formatDateTimeKst(r.createdAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-2">
                  {r.actorName ?? "—"}
                  <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">
                    {ACTOR_LABEL[r.actorType]}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                <td className="max-w-xs px-4 py-2 text-xs text-zinc-500">
                  <span className="break-all">
                    {r.detail ? JSON.stringify(r.detail) : "—"}
                  </span>
                </td>
                <td className="px-4 py-2 text-center">
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
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-400">
                  기록이 없습니다
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
