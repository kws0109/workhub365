import Link from "next/link";
import { Suspense } from "react";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { attendanceRecords, auditLogs, proposals, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";
import {
  aggregateWeeklyMinutes,
  kstDateOf,
  overtimeLevel,
  weekStartKst,
  WEEKLY_OVER_MINUTES,
  type OvertimeLevel,
} from "@/lib/attendance";
import { GraphError } from "@/lib/graph/client";
import { getLicenseUsers, getSubscribedSkus } from "@/lib/graph/licenses";
import { calcLicenseWaste } from "@/lib/license-waste";
import { buildPriceMap } from "@/lib/sku-prices";
import { countMyTurnProposals } from "@/lib/proposal-queries";
import {
  formatDateTimeKst,
  formatKrw,
  formatMinutes,
  formatTimeKst,
} from "@/lib/format";
import { getTemplate } from "@/lib/proposal";
import { ActionForm } from "@/components/action-form";
import {
  ProposalStatusBadge,
  type ProposalStatus,
} from "@/components/proposals/status-badge";
import { checkIn, checkOut } from "./attendance/actions";

const LEVEL_META: Record<OvertimeLevel, { label: string; cls: string; bar: string }> = {
  ok: { label: "정상", cls: "bg-emerald-50 text-emerald-600", bar: "bg-emerald-500" },
  warn: { label: "48시간 초과 주의", cls: "bg-amber-50 text-amber-700", bar: "bg-amber-400" },
  over: { label: "52시간 초과", cls: "bg-red-50 text-red-600", bar: "bg-red-500" },
};

export default async function HomePage() {
  const session = await requireSession();
  const now = new Date();
  const today = kstDateOf(now);
  const weekStart = weekStartKst(now);

  // 위젯 데이터는 단일 병렬 스테이지로 (원격 DB 왕복 ~200ms 관행)
  const [me, myWeek, pendingApprovals, myProposals] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, session.user.id) }),
    db.query.attendanceRecords.findMany({
      where: and(
        eq(attendanceRecords.userId, session.user.id),
        gte(attendanceRecords.date, weekStart),
      ),
      orderBy: attendanceRecords.date,
    }),
    countMyTurnProposals(session.user.id),
    db
      .select({
        id: proposals.id,
        templateKey: proposals.templateKey,
        title: proposals.title,
        status: proposals.status,
        createdAt: proposals.createdAt,
      })
      .from(proposals)
      .where(eq(proposals.authorId, session.user.id))
      .orderBy(desc(proposals.createdAt))
      .limit(5),
  ]);

  const myToday = myWeek.find((r) => r.date === today);
  const weeklyMinutes = aggregateWeeklyMinutes(myWeek, weekStart);
  const level = overtimeLevel(weeklyMinutes);
  const remainingDays = Number(me?.annualLeaveDays ?? 0);

  const workBadge = !myToday
    ? { label: "출근 전", cls: "bg-zinc-100 text-zinc-500" }
    : !myToday.checkOutAt
      ? { label: "근무 중", cls: "bg-emerald-50 text-emerald-600" }
      : { label: "퇴근 완료", cls: "bg-blue-50 text-blue-600" };

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight">
        안녕하세요, {session.user.name}님
      </h1>
      <p className="mt-1 text-sm text-zinc-500">{today} · 오늘의 업무 요약입니다</p>

      {/* 근무 상태 카드 — 출퇴근 액션은 /attendance와 동일 서버 액션 재사용 */}
      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">{me?.name ?? session.user.name}</h2>
              {me?.department && (
                <span className="text-sm text-zinc-400">{me.department}</span>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${workBadge.cls}`}
              >
                {workBadge.label}
              </span>
            </div>
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

      {/* 오늘 처리할 것 — 숫자 요약 타일 */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          href="/proposals/inbox"
          label="내 차례 결재"
          value={`${pendingApprovals}건`}
          valueCls={pendingApprovals > 0 ? "text-amber-600" : undefined}
          sub={pendingApprovals > 0 ? "결재함에서 처리하세요" : "대기 중인 결재가 없습니다"}
        />
        <StatTile
          href="/leave"
          label="잔여 연차"
          value={`${remainingDays}일`}
          sub="휴가 캘린더에서 신청"
        />
        <StatTile
          href="/attendance"
          label="이번 주 근무"
          value={formatMinutes(weeklyMinutes)}
          sub={LEVEL_META[level].label}
          subCls={level === "ok" ? undefined : LEVEL_META[level].cls}
        >
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <div
              className={`h-full ${LEVEL_META[level].bar}`}
              style={{
                width: `${Math.min(100, (weeklyMinutes / WEEKLY_OVER_MINUTES) * 100)}%`,
              }}
            />
          </div>
        </StatTile>
      </div>

      {/* 내 기안 최근 */}
      <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">내 기안 최근</h2>
          <Link
            href="/proposals"
            className="text-xs text-zinc-400 underline-offset-2 hover:underline"
          >
            전체 보기
          </Link>
        </div>
        {myProposals.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">
            작성한 기안이 없습니다 —{" "}
            <Link
              href="/proposals/new"
              className="text-zinc-600 underline underline-offset-2"
            >
              기안 작성
            </Link>
            에서 시작하세요
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {myProposals.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/proposals/${p.id}`}
                  className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-zinc-50"
                >
                  <span className="truncate font-medium">{p.title}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-400">
                    {getTemplate(p.templateKey)?.name ?? p.templateKey} ·{" "}
                    {formatDateTimeKst(p.createdAt)}
                    <ProposalStatusBadge status={p.status as ProposalStatus} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 관리 위젯 — Graph 호출이 느릴 수 있어 Suspense로 스트리밍 */}
      {session.user.role === "admin" && (
        <Suspense
          fallback={
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="h-44 animate-pulse rounded-xl border border-zinc-200 bg-white" />
              <div className="h-44 animate-pulse rounded-xl border border-zinc-200 bg-white" />
            </div>
          }
        >
          <AdminWidgets />
        </Suspense>
      )}
    </div>
  );
}

function StatTile({
  href,
  label,
  value,
  valueCls,
  sub,
  subCls,
  children,
}: {
  href: string;
  label: string;
  value: string;
  valueCls?: string;
  sub: string;
  subCls?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400"
    >
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold tracking-tight tabular-nums ${valueCls ?? ""}`}>
        {value}
      </p>
      {children}
      <p
        className={`mt-2 text-xs ${
          subCls ? `inline-block rounded-full px-2 py-0.5 font-medium ${subCls}` : "text-zinc-400"
        }`}
      >
        {sub}
      </p>
    </Link>
  );
}

/** admin 전용: 라이선스 낭비 KPI + 최근 감사 로그. Graph 실패 시 위젯만 강등 */
async function AdminWidgets() {
  const [waste, recentAudit] = await Promise.all([
    (async () => {
      try {
        const [skus, usersResult] = await Promise.all([
          getSubscribedSkus(),
          getLicenseUsers(),
        ]);
        const prices = await buildPriceMap(skus);
        return calcLicenseWaste({
          users: usersResult.users,
          skus,
          prices,
          inactiveDays: 30,
          signInAvailable: usersResult.signInAvailable,
          now: new Date(),
        });
      } catch (e) {
        return e instanceof GraphError ? `${e.code}: ${e.message}` : "알 수 없는 오류";
      }
    })(),
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        actorName: users.name,
        success: auditLogs.success,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorId, users.id))
      .orderBy(desc(auditLogs.seq))
      .limit(5),
  ]);

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Link
        href="/licenses"
        className="rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400"
      >
        <p className="text-xs font-medium text-zinc-500">월 라이선스 낭비 추정액 (30일 기준)</p>
        {typeof waste === "string" ? (
          <p className="mt-2 text-sm text-red-600">Graph 조회 실패 — {waste}</p>
        ) : (
          <>
            <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums text-red-600">
              {formatKrw(waste.totals.totalWasteKrw)}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              연 환산 {formatKrw(waste.totals.totalWasteKrw * 12)}
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              미할당 {formatKrw(waste.totals.unassignedWasteKrw)} · 비활성·차단 할당{" "}
              {formatKrw(waste.totals.assignedWasteKrw)}
            </p>
          </>
        )}
      </Link>
      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-zinc-500">최근 감사 로그</h2>
          <Link
            href="/audit"
            className="text-xs text-zinc-400 underline-offset-2 hover:underline"
          >
            전체 보기
          </Link>
        </div>
        {recentAudit.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">기록이 없습니다</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-100 text-sm">
            {recentAudit.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="truncate">
                  <span className="font-medium">{r.action}</span>
                  <span className="ml-2 text-xs text-zinc-400">
                    {r.actorName ?? "—"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-400">
                  {formatDateTimeKst(r.createdAt)}
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-medium ${
                      r.success
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-red-50 text-red-600"
                    }`}
                  >
                    {r.success ? "성공" : "실패"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
