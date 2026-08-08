import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendanceRecords, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";
import {
  aggregateWeeklyMinutes,
  kstDateOf,
  overtimeLevel,
  weekStartKst,
  WEEKLY_OVER_MINUTES,
  type OvertimeLevel,
} from "@/lib/attendance";
import { formatMinutes, formatTimeKst } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { checkIn, checkOut } from "./actions";

export const metadata = { title: "근태" };

const LEVEL_META: Record<OvertimeLevel, { label: string; cls: string }> = {
  ok: { label: "정상", cls: "bg-emerald-50 text-emerald-600" },
  warn: { label: "48시간 초과 주의", cls: "bg-amber-50 text-amber-700" },
  over: { label: "52시간 초과", cls: "bg-red-50 text-red-600" },
};

export default async function AttendancePage() {
  const session = await requireSession();
  const now = new Date();
  const today = kstDateOf(now);
  const weekStart = weekStartKst(now);
  const isApprover =
    session.user.role === "admin" || session.user.role === "manager";

  // manager 부서 범위는 서브쿼리로 흡수 — 독립 쿼리 2개를 한 스테이지에 병렬 실행
  const myDepartment = db
    .select({ department: users.department })
    .from(users)
    .where(eq(users.id, session.user.id));

  const [myWeek, teamWeek] = await Promise.all([
    db.query.attendanceRecords.findMany({
      where: and(
        eq(attendanceRecords.userId, session.user.id),
        gte(attendanceRecords.date, weekStart),
      ),
      orderBy: attendanceRecords.date,
    }),
    // manager는 자기 부서만, admin은 전사 — 결재선 범위와 동일한 원칙
    isApprover
      ? db
          .select({
            date: attendanceRecords.date,
            workedMinutes: attendanceRecords.workedMinutes,
            userId: attendanceRecords.userId,
            userName: users.name,
            department: users.department,
          })
          .from(attendanceRecords)
          .innerJoin(users, eq(attendanceRecords.userId, users.id))
          .where(
            and(
              gte(attendanceRecords.date, weekStart),
              ...(session.user.role === "manager"
                ? [eq(users.department, sql`(${myDepartment})`)]
                : []),
            ),
          )
      : Promise.resolve([]),
  ]);
  const myToday = myWeek.find((r) => r.date === today);
  const weeklyMinutes = aggregateWeeklyMinutes(myWeek, weekStart);
  const level = overtimeLevel(weeklyMinutes);

  const teamTotals = new Map<
    string,
    { name: string; department: string | null; minutes: number }
  >();
  for (const r of teamWeek) {
    const cur = teamTotals.get(r.userId) ?? {
      name: r.userName,
      department: r.department,
      minutes: 0,
    };
    cur.minutes += r.workedMinutes ?? 0;
    teamTotals.set(r.userId, cur);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight">근태</h1>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">오늘 ({today})</h2>
            <p className="mt-1 text-sm text-zinc-500">
              출근 {formatTimeKst(myToday?.checkInAt ?? null)} · 퇴근{" "}
              {formatTimeKst(myToday?.checkOutAt ?? null)}
              {myToday?.workedMinutes != null &&
                ` · ${formatMinutes(myToday.workedMinutes)} 근무`}
            </p>
          </div>
          <div className="flex gap-2">
            <ActionForm action={checkIn}>
              <button
                disabled={!!myToday}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
              >
                출근
              </button>
            </ActionForm>
            <ActionForm action={checkOut}>
              <button
                disabled={!!myToday?.checkOutAt}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
              >
                퇴근
              </button>
            </ActionForm>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">이번 주 ({weekStart} 시작)</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">{formatMinutes(weeklyMinutes)}</span>
            <LevelBadge level={level} />
          </div>
        </div>
        {/* 52시간 게이지 */}
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
          <div
            className={`h-full ${
              level === "over"
                ? "bg-red-500"
                : level === "warn"
                  ? "bg-amber-400"
                  : "bg-emerald-500"
            }`}
            style={{
              width: `${Math.min(100, (weeklyMinutes / WEEKLY_OVER_MINUTES) * 100)}%`,
            }}
          />
        </div>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
              <th className="py-1.5 font-medium">날짜</th>
              <th className="py-1.5 font-medium">출근</th>
              <th className="py-1.5 font-medium">퇴근</th>
              <th className="py-1.5 text-right font-medium">근무</th>
            </tr>
          </thead>
          <tbody>
            {myWeek.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-zinc-400">
                  이번 주 기록이 없습니다
                </td>
              </tr>
            )}
            {myWeek.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-1.5">{r.date}</td>
                <td className="py-1.5">{formatTimeKst(r.checkInAt)}</td>
                <td className="py-1.5">{formatTimeKst(r.checkOutAt)}</td>
                <td className="py-1.5 text-right">
                  {r.workedMinutes != null ? formatMinutes(r.workedMinutes) : "근무 중"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {isApprover && (
        <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="font-semibold">팀 주간 현황</h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="py-1.5 font-medium">이름</th>
                <th className="py-1.5 font-medium">부서</th>
                <th className="py-1.5 text-right font-medium">주간 근무</th>
                <th className="py-1.5 text-right font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {teamTotals.size === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-zinc-400">
                    이번 주 기록이 없습니다
                  </td>
                </tr>
              )}
              {[...teamTotals.values()]
                .sort((a, b) => b.minutes - a.minutes)
                .map((t, i) => (
                  <tr key={i} className="border-b border-zinc-100 last:border-0">
                    <td className="py-1.5 font-medium">{t.name}</td>
                    <td className="py-1.5 text-zinc-500">{t.department ?? "—"}</td>
                    <td className="py-1.5 text-right">{formatMinutes(t.minutes)}</td>
                    <td className="py-1.5 text-right">
                      <LevelBadge level={overtimeLevel(t.minutes)} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function LevelBadge({ level }: { level: OvertimeLevel }) {
  const meta = LEVEL_META[level];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}
