import { and, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { leaveRequests, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";
import { kstDateOf } from "@/lib/attendance";
import { isCalendarMonth } from "@/lib/date-param";
import { ensurePublicHolidays, getHolidaysBetween } from "@/lib/holidays";
import { ActionForm } from "@/components/action-form";
import { LeaveCalendar } from "@/components/leave/leave-calendar";
import {
  addCompanyHoliday,
  cancelLeave,
  createLeave,
  decideLeave,
  deleteHoliday,
  resyncHolidays,
} from "./actions";

const TYPE_LABEL = { annual: "연차", half: "반차", sick: "병가" } as const;
const STATUS_META = {
  pending: { label: "대기", cls: "bg-amber-50 text-amber-700" },
  approved_1: { label: "1차 승인", cls: "bg-blue-50 text-blue-600" },
  approved: { label: "승인", cls: "bg-emerald-50 text-emerald-600" },
  rejected: { label: "반려", cls: "bg-red-50 text-red-600" },
  cancelled: { label: "취소", cls: "bg-fill text-ink-secondary" },
} as const;

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireSession();
  const role = session.user.role;
  const isApprover = role === "admin" || role === "manager";

  // ── 달력·휴일 준비 ──
  const { month } = await searchParams;
  const todayKst = kstDateOf(new Date());
  const thisMonth = todayKst.slice(0, 7);
  // 월(01~12)·연도(2000~2100)까지 실재성을 확인하고 아니면 이번 달로 폴백한다.
  // 이 한 줄이 monthStart/monthEnd의 date 캐스팅 오류(2026-13-01), prevYm/nextYm 계산,
  // ensurePublicHolidays(y)의 연도 범위를 동시에 지킨다
  const ym = isCalendarMonth(month) ? month : thisMonth;
  const [y, m] = ym.split("-").map(Number);
  const thisYear = Number(todayKst.slice(0, 4));
  const monthStart = `${ym}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEnd = `${ym}-${String(daysInMonth).padStart(2, "0")}`;

  // 원격 DB는 왕복당 수백 ms — 부서 의존은 상관 서브쿼리로 흡수해
  // 모든 쿼리를 단일 병렬 스테이지로 실행한다.
  const myDepartment = db
    .select({ department: users.department })
    .from(users)
    .where(eq(users.id, session.user.id));
  // 직원 가시성: 같은 부서 (부서 미지정이면 본인만 — OR 절이 커버)
  const sameDeptUserIds = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.department, sql`(${myDepartment})`));

  // 공휴일 보장은 프로세스 첫 요청에서만 실제 작업 — 휴일 읽기는 이것만 대기
  const ensured = ensurePublicHolidays([y, thisYear, thisYear + 1]);

  const [me, myRequests, myActiveRows, monthHolidays, formHolidays, inbox, approvedRows] =
    await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, session.user.id) }),
      db.query.leaveRequests.findMany({
        where: eq(leaveRequests.userId, session.user.id),
        orderBy: desc(leaveRequests.createdAt),
        limit: 20,
      }),
      // 내 대기·1차 승인 신청도 캘린더에 표시 (점선) — 신청 직후 바로 보여야 한다
      db.query.leaveRequests.findMany({
        where: and(
          eq(leaveRequests.userId, session.user.id),
          inArray(leaveRequests.status, ["pending", "approved_1"]),
          lte(leaveRequests.startDate, monthEnd),
          gte(leaveRequests.endDate, monthStart),
        ),
      }),
      ensured.then(() => getHolidaysBetween(monthStart, monthEnd)),
      ensured.then(() =>
        getHolidaysBetween(`${thisYear}-01-01`, `${thisYear + 1}-12-31`),
      ),
      // 결재함: manager는 자기 부서만(서브쿼리), admin은 전체
      isApprover
        ? db
            .select({
              id: leaveRequests.id,
              type: leaveRequests.type,
              startDate: leaveRequests.startDate,
              endDate: leaveRequests.endDate,
              days: leaveRequests.days,
              reason: leaveRequests.reason,
              status: leaveRequests.status,
              userName: users.name,
              department: users.department,
            })
            .from(leaveRequests)
            .innerJoin(users, eq(leaveRequests.userId, users.id))
            .where(
              and(
                or(
                  eq(leaveRequests.status, "pending"),
                  eq(leaveRequests.status, "approved_1"),
                ),
                ne(leaveRequests.userId, session.user.id),
                ...(role === "manager"
                  ? [eq(users.department, sql`(${myDepartment})`)]
                  : []),
              ),
            )
            .orderBy(desc(leaveRequests.createdAt))
        : Promise.resolve([]),
      db
        .select({
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          type: leaveRequests.type,
          userName: users.name,
        })
        .from(leaveRequests)
        .innerJoin(users, eq(leaveRequests.userId, users.id))
        .where(
          and(
            eq(leaveRequests.status, "approved"),
            lte(leaveRequests.startDate, monthEnd),
            gte(leaveRequests.endDate, monthStart),
            ...(role === "employee"
              ? [
                  or(
                    eq(leaveRequests.userId, session.user.id),
                    inArray(leaveRequests.userId, sameDeptUserIds),
                  ),
                ]
              : []),
          ),
        ),
    ]);

  const calendarEntries = [
    ...approvedRows.map((r) => ({ ...r, status: "approved" as const })),
    ...myActiveRows.map((r) => ({
      startDate: r.startDate,
      endDate: r.endDate,
      type: r.type,
      userName: me?.name ?? "나",
      status: "pending" as const,
    })),
  ];

  const prevYm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const nextYm = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const firstDow = new Date(`${monthStart}T00:00:00Z`).getUTCDay(); // 0=일

  return (
    <div>
      {/* 팀 캘린더 — 날짜 클릭으로 신청 (모달) */}
      <div>
        <LeaveCalendar
          ym={ym}
          prevYm={prevYm}
          nextYm={nextYm}
          firstDow={firstDow}
          daysInMonth={daysInMonth}
          monthHolidays={monthHolidays.map((h) => ({ date: h.date, name: h.name }))}
          entries={calendarEntries}
          holidayDates={formHolidays.map((h) => h.date)}
          remainingDays={Number(me?.annualLeaveDays ?? 0)}
          visibilityNote={
            role === "employee"
              ? `같은 부서(${me?.department ?? "미지정"})의 승인된 휴가만 표시`
              : undefined
          }
          action={createLeave}
        />
      </div>

      <div className="mt-6">
        {/* 내 신청 */}
        <section className="rounded-xl border border-line bg-white p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">내 신청</h2>
            <p className="text-sm text-ink-secondary">
              잔여 연차{" "}
              <span className="font-bold text-ink">
                {Number(me?.annualLeaveDays ?? 0)}일
              </span>
            </p>
          </div>
          <ul className="mt-3 space-y-2">
            {myRequests.length === 0 && (
              <li className="text-sm text-ink-muted">신청 내역이 없습니다</li>
            )}
            {myRequests.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-fill px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{TYPE_LABEL[r.type]}</span>{" "}
                  {r.startDate}
                  {r.endDate !== r.startDate && ` ~ ${r.endDate}`}{" "}
                  <span className="text-ink-muted">({Number(r.days)}일)</span>
                  {r.rejectReason && (
                    <p className="text-xs text-red-500">
                      반려 사유: {r.rejectReason}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  {r.status === "pending" && (
                    <ActionForm action={cancelLeave}>
                      <input type="hidden" name="requestId" value={r.id} />
                      <button className="text-xs text-ink-muted underline-offset-2 hover:underline">
                        취소
                      </button>
                    </ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* 결재함 */}
      {isApprover && (
        <section className="mt-6 rounded-xl border border-line bg-white p-5">
          <h2 className="font-semibold">
            결재함
            {role === "manager" && (
              <span className="ml-2 text-xs font-normal text-ink-muted">
                {me?.department ?? "부서 미지정"} 부서만 표시
              </span>
            )}
          </h2>
          <ul className="mt-3 space-y-2">
            {inbox.length === 0 && (
              <li className="text-sm text-ink-muted">대기 중인 결재가 없습니다</li>
            )}
            {inbox.map((r) => {
              // 최종 승인(approved_1)은 admin만 가능 — manager에게 실패할 버튼을 보여주지 않는다
              const canApprove = r.status === "pending" || role === "admin";
              return (
                <li
                  key={r.id}
                  className="rounded-lg border border-fill px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">{r.userName}</span>
                      <span className="ml-1 text-xs text-ink-muted">
                        {r.department ?? ""}
                      </span>{" "}
                      · {TYPE_LABEL[r.type]} {r.startDate}
                      {r.endDate !== r.startDate && ` ~ ${r.endDate}`}{" "}
                      <span className="text-ink-muted">({Number(r.days)}일)</span>
                      {r.reason && (
                        <span className="ml-1 text-xs text-ink-muted">
                          — {r.reason}
                        </span>
                      )}
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <ActionForm action={decideLeave} className="mt-2">
                    <div className="flex items-center gap-2">
                      <input type="hidden" name="requestId" value={r.id} />
                      <input
                        name="rejectReason"
                        placeholder="반려 시 사유 (필수)"
                        className="flex-1 rounded-lg border border-line px-2 py-1 text-xs"
                      />
                      {canApprove && (
                        <button
                          name="action"
                          value="approve"
                          className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                        >
                          승인
                        </button>
                      )}
                      <button
                        name="action"
                        value="reject"
                        className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500"
                      >
                        반려
                      </button>
                    </div>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 휴일 관리 (admin) */}
      {role === "admin" && (
        <section className="mt-6 rounded-xl border border-line bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">휴일 관리</h2>
            <ActionForm action={resyncHolidays}>
              <input type="hidden" name="year" value={y} />
              <button className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium hover:bg-canvas">
                {y}년 공휴일 다시 동기화
              </button>
            </ActionForm>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            공휴일은 자동 수집(Nager.Date)되며, 전사 휴일·임시 공휴일을 직접
            추가할 수 있습니다. 휴일은 휴가 일수 계산에서 제외됩니다.
          </p>
          <ActionForm action={addCompanyHoliday} className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                name="date"
                required
                className="rounded-lg border border-line px-3 py-1.5 text-sm"
              />
              <input
                name="name"
                required
                placeholder="휴일 이름 (예: 창립기념일)"
                className="rounded-lg border border-line px-3 py-1.5 text-sm"
              />
              <button className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-body">
                전사 휴일 추가
              </button>
            </div>
          </ActionForm>
          <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {monthHolidays.length === 0 && (
              <li className="text-sm text-ink-muted">{ym}에 휴일이 없습니다</li>
            )}
            {monthHolidays.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between rounded-lg border border-fill px-3 py-1.5 text-sm"
              >
                <span>
                  {h.date} {h.name}
                  <span
                    className={`ml-2 rounded-full px-1.5 py-0.5 text-xs ${
                      h.source === "public"
                        ? "bg-red-50 text-red-500"
                        : "bg-blue-50 text-blue-600"
                    }`}
                  >
                    {h.source === "public" ? "공휴일" : "전사 휴일"}
                  </span>
                </span>
                <ActionForm action={deleteHoliday}>
                  <input type="hidden" name="id" value={h.id} />
                  <button className="text-xs text-ink-muted underline-offset-2 hover:underline">
                    삭제
                  </button>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: keyof typeof STATUS_META }) {
  const s = STATUS_META[status];
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}
