"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import type { ActionState } from "@/components/action-form";
import { countLeaveDays, isNonWorkingDay, type LeaveType } from "@/lib/leave";

type CalendarEntry = {
  startDate: string;
  endDate: string;
  type: LeaveType;
  userName: string;
  /** approved = 확정(실선), pending = 내 대기·1차 승인(점선) */
  status: "approved" | "pending";
};

type HolidayItem = { date: string; name: string };

const MAX_LANES = 4;

/**
 * 기간이 겹치는 휴가들에 세로 슬롯(레인)을 배정한다.
 * 같은 휴가는 어느 날짜 셀에서든 같은 레인에 그려져 바가 끊기지 않는다
 */
function assignLanes(entries: CalendarEntry[]): number[] {
  const order = entries
    .map((e, i) => i)
    .sort(
      (a, b) =>
        entries[a].startDate.localeCompare(entries[b].startDate) ||
        entries[b].endDate.localeCompare(entries[a].endDate),
    );
  const laneEnd: string[] = [];
  const laneOf = new Array<number>(entries.length).fill(0);
  for (const i of order) {
    let lane = laneEnd.findIndex((end) => end < entries[i].startDate);
    if (lane === -1) {
      lane = laneEnd.length;
      laneEnd.push(entries[i].endDate);
    } else {
      laneEnd[lane] = entries[i].endDate;
    }
    laneOf[i] = lane;
  }
  return laneOf;
}

/**
 * 팀 캘린더 + 클릭 신청 모달.
 * 근무일 셀을 클릭하면 해당 날짜로 휴가 신청 모달이 열린다.
 * 주말·휴일 셀은 클릭 자체가 불가 — 신청 차단을 UI 구조로 강제한다.
 */
export function LeaveCalendar({
  ym,
  prevYm,
  nextYm,
  firstDow,
  daysInMonth,
  monthHolidays,
  entries,
  holidayDates,
  remainingDays,
  visibilityNote,
  action,
}: {
  ym: string;
  prevYm: string;
  nextYm: string;
  firstDow: number;
  daysInMonth: number;
  monthHolidays: HolidayItem[];
  entries: CalendarEntry[];
  holidayDates: string[];
  remainingDays: number;
  visibilityNote?: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // +n을 눌러 펼친 셀들 — 펼치면 레인 상한 없이 전부 표시
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const holidaySet = useMemo(() => new Set(holidayDates), [holidayDates]);

  function toggleExpanded(date: string) {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }
  const holidayByDate = useMemo(
    () => new Map(monthHolidays.map((h) => [h.date, h.name])),
    [monthHolidays],
  );
  const laneOf = useMemo(() => assignLanes(entries), [entries]);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">팀 캘린더</h2>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/leave?month=${prevYm}`} className="rounded px-2 py-1 hover:bg-zinc-100">
            ←
          </Link>
          <span className="font-medium">{ym}</span>
          <Link href={`/leave?month=${nextYm}`} className="rounded px-2 py-1 hover:bg-zinc-100">
            →
          </Link>
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-400">
        날짜를 클릭하면 휴가를 신청할 수 있습니다 (주말·휴일 제외) · 점선은 결재
        대기 중인 내 신청
        {visibilityNote && ` · ${visibilityNote}`}
      </p>

      <div className="mt-3 grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-zinc-200 text-xs">
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <div key={d} className="bg-zinc-50 px-2 py-1 text-center font-medium text-zinc-500">
            {d}
          </div>
        ))}
        {Array.from({ length: firstDow }).map((_, i) => (
          <div key={`pad-${i}`} className="min-h-16 bg-white" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const date = `${ym}-${String(i + 1).padStart(2, "0")}`;
          const dow = (firstDow + i) % 7; // 0=일 … 6=토
          const holidayName = holidayByDate.get(date);
          const nonWorking = isNonWorkingDay(date, holidaySet);

          const cellEntries = entries
            .map((e, idx) => ({ ...e, lane: laneOf[idx] }))
            .filter((e) => e.startDate <= date && date <= e.endDate);
          const isExpanded = expandedDates.has(date);
          // 접었을 때 숨겨질 개수 기준으로 토글을 판단해야
          // 펼친 뒤에도 접기 버튼이 유지된다 (항목 수 ≤ 상한이어도 레인 번호로 숨는 경우)
          const hiddenWhenCollapsed = cellEntries.filter(
            (e) => e.lane >= MAX_LANES,
          ).length;
          const visible = isExpanded
            ? cellEntries
            : cellEntries.filter((e) => e.lane < MAX_LANES);
          const extra = cellEntries.length - visible.length;
          const maxLane = visible.reduce((m, e) => Math.max(m, e.lane), -1);
          // 레인 자리를 비워서라도 유지해야 바가 날짜를 넘어가며 세로로 정렬된다
          const slots = Array.from({ length: maxLane + 1 }, (_, lane) =>
            visible.find((e) => e.lane === lane) ?? null,
          );

          return (
            // +n 펼치기 버튼을 안에 품어야 해서 셀은 button이 아닌 클릭 가능한 div
            // (버튼 중첩은 불가). 상단 정렬 flex 컬럼으로 레인 기준선을 통일한다
            <div
              key={date}
              onClick={nonWorking ? undefined : () => setSelectedDate(date)}
              title={nonWorking ? holidayName ?? "휴무일" : `${date} 휴가 신청`}
              className={`flex min-h-16 flex-col items-stretch justify-start p-1 text-left transition ${
                holidayName || nonWorking ? "bg-red-50/60" : "bg-white"
              } ${nonWorking ? "cursor-not-allowed" : "cursor-pointer hover:bg-zinc-50"}`}
            >
              {/* 공휴일 이름은 날짜 줄에 인라인 — 별도 줄을 차지하면 레인
                  기준선이 밀려 이어지는 휴가 바가 공휴일 셀에서 꼬인다 */}
              <p
                className={`truncate ${
                  holidayName
                    ? "font-medium text-red-500"
                    : nonWorking
                      ? "text-red-400"
                      : "text-zinc-400"
                }`}
              >
                {i + 1}
                {holidayName && (
                  <span className="ml-1 text-[10px]">{holidayName}</span>
                )}
              </p>
              {slots.map((e, lane) => {
                if (!e) {
                  // 빈 레인 자리 지킴이 — 위 레인의 바가 어긋나지 않게 한다
                  return <span key={lane} className="mt-0.5 block h-[18px]" />;
                }
                const contLeft = e.startDate < date && dow !== 0;
                const contRight = e.endDate > date && dow !== 6;
                const showLabel =
                  e.startDate === date || dow === 0 || i === 0;
                const style =
                  e.status === "approved"
                    ? "bg-emerald-100 text-emerald-700"
                    : "border border-dashed border-amber-400 bg-amber-50 text-amber-700";
                return (
                  <span
                    key={lane}
                    className={`mt-0.5 block h-[18px] truncate px-1 text-[11px] leading-[16px] ${style} ${
                      contLeft ? "-ml-[9px] rounded-l-none" : "rounded-l"
                    } ${contRight ? "rounded-r-none" : "rounded-r"}`}
                  >
                    {showLabel ? (
                      <>
                        {e.userName}
                        {e.type === "half" && " (반차)"}
                        {e.status === "pending" && " (대기)"}
                      </>
                    ) : (
                      " "
                    )}
                  </span>
                );
              })}
              {/* +n / 접기는 셀 클릭(신청 모달)과 분리된 토글 — 전파 차단 필수 */}
              {(extra > 0 || (isExpanded && hiddenWhenCollapsed > 0)) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpanded(date);
                  }}
                  className="mt-0.5 self-start rounded px-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700"
                >
                  {isExpanded ? "접기" : `+${extra}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {selectedDate && (
        <RequestModal
          key={selectedDate}
          initialDate={selectedDate}
          holidaySet={holidaySet}
          remainingDays={remainingDays}
          action={action}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </section>
  );
}

function RequestModal({
  initialDate,
  holidaySet,
  remainingDays,
  action,
  onClose,
}: {
  initialDate: string;
  holidaySet: Set<string>;
  remainingDays: number;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [type, setType] = useState<LeaveType>("annual");
  // 클릭한 날짜가 기본 시작일 — 모달 안에서 수정 가능
  const [startDate, setStartDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialDate);

  // 성공 시 모달을 닫는다 — revalidatePath가 캘린더를 갱신한다
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  const effectiveEnd = type === "half" ? startDate : endDate || startDate;
  const days = countLeaveDays(type, startDate, effectiveEnd, holidaySet);
  const overBalance = type !== "sick" && days > remainingDays;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">휴가 신청</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <form action={formAction} className="mt-4">
          <fieldset disabled={pending} className="contents">
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500">유형</span>
                <select
                  name="type"
                  value={type}
                  onChange={(e) => setType(e.target.value as LeaveType)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                >
                  <option value="annual">연차</option>
                  <option value="half">반차 (0.5일)</option>
                  <option value="sick">병가 (차감 없음)</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500">
                  시작일
                </span>
                <input
                  type="date"
                  name="startDate"
                  required
                  value={startDate}
                  onChange={(e) => {
                    const next = e.target.value;
                    // 시작일이 종료일을 넘어가는 변경은 적용하지 않고 알린다
                    if (type !== "half" && next && endDate && next > endDate) {
                      window.alert("시작일은 종료일 이후로 설정할 수 없습니다");
                      return;
                    }
                    setStartDate(next);
                  }}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
              </label>
              {type !== "half" && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">
                    종료일 (기본: 하루)
                  </span>
                  <input
                    type="date"
                    name="endDate"
                    min={startDate}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500">
                  사유 (선택)
                </span>
                <input
                  name="reason"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <p className="mt-3 text-xs text-zinc-500">
              예상 차감:{" "}
              <span className={`font-semibold ${overBalance ? "text-red-600" : ""}`}>
                {type === "sick" ? "0일 (병가)" : `${days}일`}
              </span>
              {type !== "sick" && ` · 잔여 ${remainingDays}일`}
              {days > 3 && " · 2단계 결재 대상"}
            </p>
            {days <= 0 && (
              <p className="mt-1 text-xs font-medium text-red-600">
                기간에 근무일이 없습니다
              </p>
            )}
            {overBalance && (
              <p className="mt-1 text-xs font-medium text-red-600">
                잔여 연차를 초과합니다
              </p>
            )}
            {state.error && (
              <p className="mt-1 text-xs font-medium text-red-600">{state.error}</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={days <= 0 || overBalance || pending}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
              >
                {pending ? "신청 중…" : "신청"}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
