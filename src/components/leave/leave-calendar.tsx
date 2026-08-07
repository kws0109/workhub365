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
};

type HolidayItem = { date: string; name: string };

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
  const holidaySet = useMemo(() => new Set(holidayDates), [holidayDates]);
  const holidayByDate = useMemo(
    () => new Map(monthHolidays.map((h) => [h.date, h.name])),
    [monthHolidays],
  );

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
        날짜를 클릭하면 휴가를 신청할 수 있습니다 (주말·휴일 제외)
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
          const holidayName = holidayByDate.get(date);
          const nonWorking = isNonWorkingDay(date, holidaySet);
          const onLeave = entries.filter(
            (r) => r.startDate <= date && date <= r.endDate,
          );
          return (
            <button
              key={date}
              type="button"
              disabled={nonWorking}
              onClick={() => setSelectedDate(date)}
              title={nonWorking ? holidayName ?? "휴무일" : `${date} 휴가 신청`}
              className={`min-h-16 p-1 text-left align-top transition ${
                holidayName || nonWorking ? "bg-red-50/60" : "bg-white"
              } ${nonWorking ? "cursor-not-allowed" : "cursor-pointer hover:bg-zinc-50"}`}
            >
              <p className={holidayName ? "font-medium text-red-500" : nonWorking ? "text-red-400" : "text-zinc-400"}>
                {i + 1}
              </p>
              {holidayName && (
                <p className="mt-0.5 truncate rounded bg-red-100 px-1 text-red-600">
                  {holidayName}
                </p>
              )}
              {onLeave.slice(0, 3).map((r, j) => (
                <p
                  key={j}
                  className="mt-0.5 truncate rounded bg-emerald-50 px-1 text-emerald-700"
                >
                  {r.userName}
                  {r.type === "half" && " (반차)"}
                </p>
              ))}
              {onLeave.length > 3 && (
                <p className="mt-0.5 text-zinc-400">+{onLeave.length - 3}</p>
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <RequestModal
          key={selectedDate}
          startDate={selectedDate}
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
  startDate,
  holidaySet,
  remainingDays,
  action,
  onClose,
}: {
  startDate: string;
  holidaySet: Set<string>;
  remainingDays: number;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [type, setType] = useState<LeaveType>("annual");
  const [endDate, setEndDate] = useState(startDate);

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
          <h3 className="font-semibold">휴가 신청 — {startDate}</h3>
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
            <input type="hidden" name="startDate" value={startDate} />
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
