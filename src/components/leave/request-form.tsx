"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import type { ActionState } from "@/components/action-form";
import { isNonWorkingDay, type LeaveType } from "@/lib/leave";

/**
 * 휴가 신청 폼 — 주말·공휴일 단일 휴가는 제출 자체를 차단한다(버튼 비활성 + 사유 표시).
 * 서버 액션에서도 같은 검증을 하지만, 사용자는 제출 전에 알 수 있어야 한다.
 */
export function LeaveRequestForm({
  action,
  holidayDates,
  remainingDays,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  holidayDates: string[];
  remainingDays: number;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [type, setType] = useState<LeaveType>("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const holidaySet = useMemo(() => new Set(holidayDates), [holidayDates]);

  // 단일 휴가(반차 또는 시작=종료)가 휴무일에 걸리면 원천 차단
  const isSingleDay = type === "half" || !endDate || endDate === startDate;
  const blockedReason =
    startDate && isSingleDay && isNonWorkingDay(startDate, holidaySet)
      ? "선택한 날짜는 주말 또는 휴일입니다 — 휴가를 신청할 수 없습니다"
      : null;

  return (
    <form action={formAction}>
      <fieldset disabled={pending} className="contents">
        <div className="flex flex-wrap gap-2">
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as LeaveType)}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          >
            <option value="annual">연차</option>
            <option value="half">반차 (0.5일)</option>
            <option value="sick">병가 (차감 없음)</option>
          </select>
          <input
            type="date"
            name="startDate"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          />
          {type !== "half" && (
            <input
              type="date"
              name="endDate"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            />
          )}
        </div>
        <input
          name="reason"
          placeholder="사유 (선택)"
          className="mt-3 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
        />
        <p className="mt-2 text-xs text-zinc-400">
          일수는 근무일(주말·공휴일 제외) 기준 · 3일 초과는 2단계 결재 · 잔여{" "}
          {remainingDays}일
        </p>
        {blockedReason && (
          <p className="mt-2 text-xs font-medium text-red-600">{blockedReason}</p>
        )}
        {state.error && (
          <p className="mt-2 text-xs font-medium text-red-600">{state.error}</p>
        )}
        <button
          type="submit"
          disabled={!!blockedReason || !startDate || pending}
          className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
        >
          {pending ? "신청 중…" : "신청"}
        </button>
      </fieldset>
    </form>
  );
}
