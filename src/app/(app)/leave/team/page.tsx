import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { leaveRequests, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";

export const metadata = { title: "팀 연차 현황" };

// 총 연차 = 잔여 + 승인된 사용분(연차·반차). 차감은 전부 승인 트랜잭션을
// 거치므로 별도 컬럼 없이 도출해도 정확하다. 병가는 차감이 없어 제외
export default async function TeamLeavePage() {
  const session = await requireSession();

  // 부서 매칭을 서브쿼리로 흡수해 조인+집계까지 단일 왕복으로 처리
  // (원격 DB는 왕복당 수백 ms — 순차 3쿼리였던 것을 1쿼리로)
  const myDepartment = db
    .select({ department: users.department })
    .from(users)
    .where(eq(users.id, session.user.id));

  const memberRows = await db
    .select({
      id: users.id,
      name: users.name,
      department: users.department,
      remaining: users.annualLeaveDays,
      used: sql<string>`coalesce(sum(${leaveRequests.days}) filter (
        where ${leaveRequests.status} = 'approved' and ${leaveRequests.type} <> 'sick'
      ), 0)`,
    })
    .from(users)
    .leftJoin(leaveRequests, eq(leaveRequests.userId, users.id))
    .where(
      or(
        eq(users.id, session.user.id),
        and(isNotNull(users.department), eq(users.department, sql`(${myDepartment})`)),
      ),
    )
    .groupBy(users.id);

  const me = memberRows.find((m) => m.id === session.user.id);

  const rows = memberRows
    .map((m) => {
      const remaining = Number(m.remaining);
      const used = Number(m.used);
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
      <p className="text-xs text-ink-muted">
        같은 부서({me?.department ?? "미지정"}) 구성원의 연차 현황입니다
        {" · "}총 연차 = 잔여 + 사용(승인된 연차·반차)
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-secondary">
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
                <tr key={r.id} className="border-b border-fill last:border-0">
                  <td className="px-4 py-2 font-medium">
                    {r.name}
                    {r.isMe && (
                      <span className="ml-1.5 rounded-full bg-fill px-1.5 py-0.5 text-xs font-normal text-ink-secondary">
                        나
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-ink-sub">
                    {r.used}일
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">
                    {r.remaining}일
                  </td>
                  <td className="px-4 py-2 text-right text-ink-sub">
                    {r.total}일
                  </td>
                  <td className="px-4 py-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-fill">
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
                <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
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
