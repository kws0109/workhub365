import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { leaveRequests, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";

export const metadata = { title: "팀 연차 현황" };

// 총 연차 = 잔여 + 승인된 사용분(연차·반차). 차감은 전부 승인 트랜잭션을
// 거치므로 별도 컬럼 없이 도출해도 정확하다. 병가는 차감이 없어 제외
export default async function TeamLeavePage() {
  const session = await requireSession();

  const me = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  });

  // 팀 연차는 역할 무관 같은 부서 구성원만 (부서 미지정이면 본인만)
  const members = await db.query.users.findMany({
    where: me?.department
      ? eq(users.department, me.department)
      : eq(users.id, session.user.id),
  });

  const memberIds = members.map((m) => m.id);
  const usedRows =
    memberIds.length > 0
      ? await db
          .select({
            userId: leaveRequests.userId,
            used: sql<string>`coalesce(sum(${leaveRequests.days}), 0)`,
          })
          .from(leaveRequests)
          .where(
            and(
              eq(leaveRequests.status, "approved"),
              ne(leaveRequests.type, "sick"),
              inArray(leaveRequests.userId, memberIds),
            ),
          )
          .groupBy(leaveRequests.userId)
      : [];
  const usedByUser = new Map(usedRows.map((r) => [r.userId, Number(r.used)]));

  const rows = members
    .map((m) => {
      const remaining = Number(m.annualLeaveDays);
      const used = usedByUser.get(m.id) ?? 0;
      return {
        id: m.id,
        name: m.name,
        isMe: m.id === session.user.id,
        used,
        remaining,
        total: remaining + used,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return (
    <div>
      <p className="text-xs text-zinc-400">
        같은 부서({me?.department ?? "미지정"}) 구성원의 연차 현황입니다
        {" · "}총 연차 = 잔여 + 사용(승인된 연차·반차)
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
              <th className="px-4 py-2 font-medium">이름</th>
              <th className="px-4 py-2 text-right font-medium">사용</th>
              <th className="px-4 py-2 text-right font-medium">남은 연차</th>
              <th className="px-4 py-2 text-right font-medium">총 연차</th>
              <th className="w-40 px-4 py-2 font-medium">사용률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ratio = r.total > 0 ? Math.min(100, (r.used / r.total) * 100) : 0;
              return (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-4 py-2 font-medium">
                    {r.name}
                    {r.isMe && (
                      <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs font-normal text-zinc-500">
                        나
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-600">
                    {r.used}일
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">
                    {r.remaining}일
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-600">
                    {r.total}일
                  </td>
                  <td className="px-4 py-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${ratio}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-400">
                  표시할 구성원이 없습니다
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
