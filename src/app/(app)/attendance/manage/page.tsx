import Link from "next/link";
import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { attendanceRecords, leaveRequests, users } from "@/db/schema";
import { requireHrSession } from "@/lib/auth-helpers";
import { aggregateWeeklyMinutes, kstDateOf, weekStartKst } from "@/lib/attendance";
import { formatMinutes, formatTimeKst } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, type BadgeTone, Card, StatTile } from "@/components/ui";
import {
  correctAttendance,
  correctLeaveRequest,
  createAttendance,
  deleteAttendance,
  forceCancelLeave,
} from "./actions";

export const metadata = { title: "인사 정정" };

// 인사 정정 화면 (R4.4/R3.9) — 타인의 근태·휴가 기록을 사유 필수로 고친다.
// h1과 탭 바는 attendance/layout.tsx가 렌더하므로 여기서는 본문만 그린다.
// 모든 쓰기는 ./actions.ts의 서버 액션이 수행하고 감사 로그를 남긴다.

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DOW_LABEL = ["월", "화", "수", "목", "금", "토", "일"] as const;

// searchParams는 신뢰하지 않는다 — uuid가 아닌 값을 uuid 컬럼에 비교하면 22P02로 요청이 죽는다
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type AttendanceRow = typeof attendanceRecords.$inferSelect;
type LeaveRow = typeof leaveRequests.$inferSelect;
type TargetRow = Pick<
  typeof users.$inferSelect,
  "id" | "name" | "department" | "annualLeaveDays"
>;

const LEAVE_TYPE_LABEL: Record<LeaveRow["type"], string> = {
  annual: "연차",
  half: "반차",
  sick: "병가",
};

const STATUS_META: Record<
  LeaveRow["status"],
  { label: string; tone: BadgeTone }
> = {
  pending: { label: "대기", tone: "warn" },
  approved_1: { label: "1차 승인", tone: "info" },
  approved: { label: "승인", tone: "success" },
  rejected: { label: "반려", tone: "danger" },
  cancelled: { label: "취소", tone: "neutral" },
};

const INPUT =
  "rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-line-strong";
const REASON_INPUT = `${INPUT} min-w-40 flex-1`;
const PRIMARY_BTN =
  "rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-ink-body";
const SUBTLE_BTN =
  "rounded-md bg-fill px-2.5 py-1 text-[11px] font-medium text-ink-sub transition hover:bg-line";
const DANGER_BTN =
  "rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-red-600 transition hover:bg-red-50";
const NAV_LINK =
  "rounded-md border border-line px-2.5 py-1.5 text-[11px] font-medium text-ink-sub transition hover:bg-fill";

/** KST 날짜 문자열에 일수를 더한다 (주 이동·주간 전개용) */
function addKstDays(dateStr: string, days: number): string {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * UTC 시각 → input[type=time]이 요구하는 KST 'HH:mm'.
 * formatTimeKst는 ko-KR 로캘 표기("오후 06:30")라 폼 기본값으로 쓸 수 없다.
 * kstToUtc(lib/attendance)의 역함수 — KST는 서머타임 없는 고정 +9다.
 */
function kstTimeValue(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(11, 16);
}

export default async function AttendanceManagePage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; week?: string }>;
}) {
  const session = await requireHrSession();
  const { user, week } = await searchParams;

  const targetId = UUID_RE.test(user ?? "") ? user! : null;
  // 주 경계 정규화 — 어떤 날짜를 넣어도 그 주의 KST 월요일로 접힌다.
  // 형식이 맞아도 2026-13-45 같은 값은 Invalid Date라 유한성까지 확인한다
  const picked = DATE_RE.test(week ?? "") ? new Date(`${week}T00:00:00Z`) : null;
  const weekStart = weekStartKst(
    picked && Number.isFinite(picked.getTime()) ? picked : new Date(),
  );
  const weekEnd = addKstDays(weekStart, 6);
  const today = kstDateOf(new Date());

  // 원격 DB는 왕복당 수백 ms — 서로 독립적인 조회를 단일 병렬 스테이지로 묶는다
  const [candidates, target, records, activeLeaves, closedLeaves] =
    await Promise.all([
      // 대상 후보 — 본인 제외. 서버 액션도 셀프 정정을 막지만 고를 수조차 없어야 한다
      db
        .select({
          id: users.id,
          name: users.name,
          department: users.department,
        })
        .from(users)
        .where(ne(users.id, session.user.id))
        .orderBy(users.name)
        .limit(500),
      targetId
        ? db.query.users.findFirst({
            where: eq(users.id, targetId),
            columns: {
              id: true,
              name: true,
              department: true,
              annualLeaveDays: true,
            },
          })
        : Promise.resolve<TargetRow | undefined>(undefined),
      targetId
        ? db.query.attendanceRecords.findMany({
            where: and(
              eq(attendanceRecords.userId, targetId),
              gte(attendanceRecords.date, weekStart),
              // 상한을 반드시 건다 — 없으면 선택 주 이후의 모든 기록이 딸려온다
              lte(attendanceRecords.date, weekEnd),
            ),
            orderBy: attendanceRecords.date,
          })
        : Promise.resolve<AttendanceRow[]>([]),
      targetId
        ? db.query.leaveRequests.findMany({
            where: and(
              eq(leaveRequests.userId, targetId),
              inArray(leaveRequests.status, [
                "pending",
                "approved_1",
                "approved",
              ]),
            ),
            orderBy: desc(leaveRequests.startDate),
          })
        : Promise.resolve<LeaveRow[]>([]),
      targetId
        ? db.query.leaveRequests.findMany({
            where: and(
              eq(leaveRequests.userId, targetId),
              inArray(leaveRequests.status, ["rejected", "cancelled"]),
            ),
            orderBy: desc(leaveRequests.startDate),
            limit: 20,
          })
        : Promise.resolve<LeaveRow[]>([]),
    ]);

  const byDate = new Map(records.map((r) => [r.date, r]));
  const weeklyMinutes = aggregateWeeklyMinutes(records, weekStart);
  const weekDays = Array.from({ length: 7 }, (_, i) => addKstDays(weekStart, i));

  const weekHref = (w: string) => {
    const q = new URLSearchParams({ week: w });
    if (targetId) q.set("user", targetId);
    return `/attendance/manage?${q.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 대상·기준 주 선택 */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-ink-secondary">
                대상 직원
              </span>
              <select
                name="user"
                defaultValue={targetId ?? ""}
                className={`${INPUT} min-w-52 py-1.5 text-[13px]`}
              >
                <option value="">직원 선택</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.department ? ` · ${c.department}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-ink-secondary">
                기준 주 (주중 아무 날짜)
              </span>
              <input
                type="date"
                name="week"
                defaultValue={weekStart}
                className={`${INPUT} py-1.5 text-[13px]`}
              />
            </label>
            <button type="submit" className={`${PRIMARY_BTN} py-1.5`}>
              조회
            </button>
          </form>
          <nav className="flex items-center gap-1.5">
            <Link href={weekHref(addKstDays(weekStart, -7))} className={NAV_LINK}>
              이전 주
            </Link>
            <Link href={weekHref(addKstDays(weekStart, 7))} className={NAV_LINK}>
              다음 주
            </Link>
          </nav>
        </div>
        <p className="mt-2.5 text-[11px] text-ink-muted">
          {weekStart} ~ {weekEnd} · 정정·삭제는 모두 감사 로그에 남습니다. 본인
          기록은 정정할 수 없습니다.
        </p>
      </Card>

      {!target ? (
        <Card className="px-6 py-10 text-center">
          <p className="text-sm font-medium">
            {targetId ? "직원을 찾을 수 없습니다" : "직원을 선택하세요"}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            대상 직원을 고르면 해당 주의 근태 기록과 휴가 신청을 정정할 수
            있습니다
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatTile
              compact
              label="주간 근무"
              value={formatMinutes(weeklyMinutes)}
              caption={`${weekStart} ~ ${weekEnd}`}
            />
            <StatTile
              compact
              label="기록된 근무일"
              value={`${records.length}일`}
              caption="선택 주 7일 기준"
            />
            <StatTile
              compact
              label="잔여 연차"
              value={`${Number(target.annualLeaveDays)}일`}
              caption={`${target.name} · ${target.department ?? "부서 미지정"}`}
            />
          </div>

          {/* 근태 정정 — 선택 주 7일을 전부 펼치고 기록을 좌조인 */}
          <section>
            <h2 className="text-[15px] font-semibold">근태 정정</h2>
            <p className="mt-1 text-xs text-ink-muted">
              근무일은 출근 시각의 KST 날짜로 다시 계산됩니다. 근무 중인 기록은
              출근 시각을 바꿀 수 없고 퇴근만 채웁니다.
            </p>
            <div className="mt-2.5 overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] font-medium text-ink-muted">
                    <th className="px-4 py-2 font-medium">근무일</th>
                    <th className="px-4 py-2 font-medium">현재 기록</th>
                    <th className="px-4 py-2 font-medium">정정</th>
                  </tr>
                </thead>
                <tbody>
                  {weekDays.map((date, i) => (
                    <AttendanceDayRow
                      key={date}
                      date={date}
                      dow={DOW_LABEL[i]}
                      record={byDate.get(date)}
                      targetUserId={target.id}
                      future={date > today}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 휴가 정정 — 진행 중인 신청만 편집 가능 */}
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold">휴가 정정</h2>
              <p className="text-xs text-ink-secondary">
                잔여 연차{" "}
                <span className="font-semibold text-ink">
                  {Number(target.annualLeaveDays)}일
                </span>
              </p>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              유형·기간을 고치면 일수와 잔여 연차를 서버가 휴일 집합으로 다시
              계산합니다. 결재 상태와 결재자는 바뀌지 않습니다.
            </p>
            <ul className="mt-2.5 flex flex-col gap-2">
              {activeLeaves.length === 0 && (
                <li>
                  <Card className="px-4 py-3 text-xs text-ink-muted">
                    진행 중인 휴가 신청이 없습니다
                  </Card>
                </li>
              )}
              {activeLeaves.map((r) => (
                <li key={r.id}>
                  <Card className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[13px]">
                        <span className="font-medium">
                          {LEAVE_TYPE_LABEL[r.type]}
                        </span>{" "}
                        {r.startDate}
                        {r.endDate !== r.startDate && ` ~ ${r.endDate}`}
                        {r.reason && (
                          <span className="ml-1 text-[11px] text-ink-muted">
                            — {r.reason}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-ink-secondary">
                          현재 {Number(r.days)}일
                        </span>
                        <Badge tone={STATUS_META[r.status].tone}>
                          {STATUS_META[r.status].label}
                        </Badge>
                      </div>
                    </div>
                    <ActionForm action={correctLeaveRequest} className="mt-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input type="hidden" name="requestId" value={r.id} />
                        <select
                          name="type"
                          defaultValue={r.type}
                          aria-label="휴가 유형"
                          className={INPUT}
                        >
                          {Object.entries(LEAVE_TYPE_LABEL).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                        <input
                          type="date"
                          name="startDate"
                          required
                          defaultValue={r.startDate}
                          aria-label="시작일"
                          className={INPUT}
                        />
                        <span className="text-[11px] text-ink-muted">~</span>
                        <input
                          type="date"
                          name="endDate"
                          required
                          defaultValue={r.endDate}
                          aria-label="종료일"
                          className={INPUT}
                        />
                        <input
                          name="reason"
                          required
                          maxLength={500}
                          placeholder="정정 사유 (필수)"
                          aria-label="정정 사유"
                          className={REASON_INPUT}
                        />
                        <button type="submit" className={PRIMARY_BTN}>
                          정정 저장
                        </button>
                      </div>
                    </ActionForm>
                    {/* 취소는 별도 폼 — 정정 폼의 required가 취소 제출을 막지 않게 한다 */}
                    <ActionForm action={forceCancelLeave} className="mt-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input type="hidden" name="requestId" value={r.id} />
                        <input
                          name="reason"
                          required
                          maxLength={500}
                          placeholder="취소 사유 (필수)"
                          aria-label="취소 사유"
                          className={REASON_INPUT}
                        />
                        <button type="submit" className={DANGER_BTN}>
                          정정 취소
                        </button>
                      </div>
                    </ActionForm>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          {/* 종결 건 — 반려·취소는 상태머신상 되돌릴 수 없으므로 읽기 전용 */}
          <section>
            <h2 className="text-[15px] font-semibold">종결된 신청</h2>
            <p className="mt-1 text-xs text-ink-muted">
              반려·취소 건은 정정할 수 없습니다 (최근 20건)
            </p>
            <div className="mt-2.5 overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] font-medium text-ink-muted">
                    <th className="px-4 py-2 font-medium">유형</th>
                    <th className="px-4 py-2 font-medium">기간</th>
                    <th className="px-4 py-2 text-right font-medium">일수</th>
                    <th className="px-4 py-2 text-right font-medium">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {closedLeaves.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-4 text-center text-ink-muted"
                      >
                        종결된 신청이 없습니다
                      </td>
                    </tr>
                  )}
                  {closedLeaves.map((r) => (
                    <tr key={r.id} className="border-t border-fill">
                      <td className="px-4 py-2.5 align-top">
                        {LEAVE_TYPE_LABEL[r.type]}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        {r.startDate}
                        {r.endDate !== r.startDate && ` ~ ${r.endDate}`}
                        {r.rejectReason && (
                          <p className="text-[11px] text-ink-muted">
                            반려 사유: {r.rejectReason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right align-top">
                        {Number(r.days)}일
                      </td>
                      <td className="px-4 py-2.5 text-right align-top">
                        <Badge tone={STATUS_META[r.status].tone}>
                          {STATUS_META[r.status].label}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/**
 * 주간 표의 한 행. 기록 유무·개폐 상태에 따라 세 갈래 폼을 렌더한다.
 * 삭제는 정정 폼의 required가 제출을 막지 않도록 항상 별도 폼으로 분리한다.
 */
function AttendanceDayRow({
  date,
  dow,
  record,
  targetUserId,
  future,
}: {
  date: string;
  dow: string;
  record: AttendanceRow | undefined;
  targetUserId: string;
  future: boolean;
}) {
  const open = record != null && record.checkOutAt === null;
  // 자정 넘김 퇴근이면 '익일' 체크를 미리 켜 둔다 (readCheckOut의 해석과 동일)
  const nextDayOut =
    record?.checkOutAt != null &&
    kstDateOf(record.checkOutAt) !== kstDateOf(record.checkInAt);

  return (
    <tr className="border-t border-fill">
      <td className="whitespace-nowrap px-4 py-3 align-top">
        <p className="font-medium">{date}</p>
        <p className="text-[11px] text-ink-muted">{dow}요일</p>
      </td>
      <td className="whitespace-nowrap px-4 py-3 align-top">
        <div className="flex flex-col items-start gap-1">
          {open && <Badge tone="info">근무 중</Badge>}
          {!record && !future && <Badge tone="warn">누락</Badge>}
          {record?.note && <Badge tone="neutral">정정됨</Badge>}
          {record ? (
            <span className="text-[11px] text-ink-secondary">
              {formatTimeKst(record.checkInAt)} ~{" "}
              {formatTimeKst(record.checkOutAt)}
              {record.workedMinutes != null &&
                ` · ${formatMinutes(record.workedMinutes)}`}
            </span>
          ) : (
            <span className="text-[11px] text-ink-muted">기록 없음</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        {record ? (
          <>
            <ActionForm action={correctAttendance}>
              <div className="flex flex-wrap items-center gap-1.5">
                <input type="hidden" name="recordId" value={record.id} />
                <span className="text-[11px] text-ink-secondary">출근</span>
                <input
                  type="date"
                  name="checkInDate"
                  required
                  // 근무 중인 기록의 출근 시각 이동은 서버가 거부한다 — 입력 자체를 잠근다
                  disabled={open}
                  defaultValue={kstDateOf(record.checkInAt)}
                  aria-label="출근 날짜"
                  className={`${INPUT} disabled:bg-fill disabled:text-ink-muted`}
                />
                <input
                  type="time"
                  name="checkInTime"
                  required
                  disabled={open}
                  defaultValue={kstTimeValue(record.checkInAt)}
                  aria-label="출근 시각"
                  className={`${INPUT} disabled:bg-fill disabled:text-ink-muted`}
                />
                <span className="text-[11px] text-ink-secondary">퇴근</span>
                <input
                  type="time"
                  name="checkOutTime"
                  required
                  defaultValue={
                    record.checkOutAt ? kstTimeValue(record.checkOutAt) : ""
                  }
                  aria-label="퇴근 시각"
                  className={INPUT}
                />
                <label className="flex items-center gap-1 text-[11px] text-ink-secondary">
                  <input
                    type="checkbox"
                    name="checkOutNextDay"
                    defaultChecked={nextDayOut}
                    className="accent-ink"
                  />
                  익일
                </label>
                <input
                  name="reason"
                  required
                  maxLength={500}
                  placeholder="정정 사유 (필수)"
                  aria-label="정정 사유"
                  className={REASON_INPUT}
                />
                <button type="submit" className={PRIMARY_BTN}>
                  {open ? "퇴근 처리" : "저장"}
                </button>
              </div>
            </ActionForm>
            <ActionForm action={deleteAttendance} className="mt-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <input type="hidden" name="recordId" value={record.id} />
                <input
                  name="reason"
                  required
                  maxLength={500}
                  placeholder="삭제 사유 (필수)"
                  aria-label="삭제 사유"
                  className={REASON_INPUT}
                />
                <button type="submit" className={DANGER_BTN}>
                  삭제
                </button>
              </div>
            </ActionForm>
          </>
        ) : future ? (
          <p className="text-[11px] text-ink-muted">
            미래 근무일은 생성할 수 없습니다
          </p>
        ) : (
          <ActionForm action={createAttendance}>
            <div className="flex flex-wrap items-center gap-1.5">
              <input type="hidden" name="targetUserId" value={targetUserId} />
              {/* 생성 행의 근무일은 고정 — 날짜는 표의 행이 결정한다 */}
              <input type="hidden" name="checkInDate" value={date} />
              <span className="text-[11px] text-ink-secondary">출근</span>
              <input
                type="time"
                name="checkInTime"
                required
                aria-label="출근 시각"
                className={INPUT}
              />
              <span className="text-[11px] text-ink-secondary">퇴근</span>
              <input
                type="time"
                name="checkOutTime"
                required
                aria-label="퇴근 시각"
                className={INPUT}
              />
              <label className="flex items-center gap-1 text-[11px] text-ink-secondary">
                <input
                  type="checkbox"
                  name="checkOutNextDay"
                  className="accent-ink"
                />
                익일
              </label>
              <input
                name="reason"
                required
                maxLength={500}
                placeholder="생성 사유 (필수)"
                aria-label="생성 사유"
                className={REASON_INPUT}
              />
              <button type="submit" className={SUBTLE_BTN}>
                생성
              </button>
            </div>
          </ActionForm>
        )}
      </td>
    </tr>
  );
}
