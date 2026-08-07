// 휴가 상태머신 — 순수 함수 (단위 테스트 대상).
// 정책:
//  - 결재선: 3일 초과 휴가는 유형 무관 2단계(1차 manager/admin → 최종 admin, 서로 다른 사람), 이하 1단계
//  - 상태 전이: pending → approved_1 → approved / pending·approved_1 → rejected(사유 필수)
//    / pending → cancelled(신청자 본인만)
//  - 차감: approved 진입 시 1회만 (연차·반차만, 병가는 기록만)
//  - 일수: 기간 내 평일(월~금) 수, 반차는 평일 하루 0.5일
//  - 알려진 한계(스펙 문서화): 국내 법정 공휴일은 평일로 계산된다

export type LeaveType = "annual" | "half" | "sick";
export type LeaveStatus =
  | "pending"
  | "approved_1"
  | "approved"
  | "rejected"
  | "cancelled";
export type Role = "admin" | "manager" | "employee";
export type LeaveAction = "approve" | "reject" | "cancel";

export const SECOND_APPROVAL_THRESHOLD_DAYS = 3;

export type LeaveRequestLike = {
  userId: string;
  type: LeaveType;
  status: LeaveStatus;
  days: number;
  /** 1차 결재자 — 2단계 결재에서 동일인 최종 승인을 차단하는 데 필요 */
  approverId?: string | null;
};

export type Actor = { id: string; role: Role };

export type TransitionResult =
  | {
      ok: true;
      nextStatus: LeaveStatus;
      /** approved 진입 시에만 차감할 일수 (연차·반차만, 병가 0) */
      deductDays: number;
    }
  | { ok: false; reason: string };

// 유형 무관 기간 기준 — 병가만 면제하면 유형 선택만으로 2단계 결재를 우회할 수 있다
export function needsSecondApproval(req: LeaveRequestLike): boolean {
  return req.days > SECOND_APPROVAL_THRESHOLD_DAYS;
}

function deductionOf(req: LeaveRequestLike): number {
  return req.type === "sick" ? 0 : req.days;
}

export function transitionLeave(
  req: LeaveRequestLike,
  action: LeaveAction,
  actor: Actor,
): TransitionResult {
  const isApprover = actor.role === "admin" || actor.role === "manager";
  const isOwner = actor.id === req.userId;

  switch (action) {
    case "cancel": {
      if (!isOwner) return { ok: false, reason: "본인만 취소할 수 있습니다" };
      if (req.status !== "pending")
        return { ok: false, reason: "대기 상태에서만 취소할 수 있습니다" };
      return { ok: true, nextStatus: "cancelled", deductDays: 0 };
    }
    case "reject": {
      if (!isApprover) return { ok: false, reason: "결재 권한이 없습니다" };
      if (req.status !== "pending" && req.status !== "approved_1")
        return { ok: false, reason: "결재 대기 상태가 아닙니다" };
      if (isOwner)
        return { ok: false, reason: "본인 신청은 결재할 수 없습니다" };
      return { ok: true, nextStatus: "rejected", deductDays: 0 };
    }
    case "approve": {
      if (!isApprover) return { ok: false, reason: "결재 권한이 없습니다" };
      if (isOwner)
        return { ok: false, reason: "본인 신청은 결재할 수 없습니다" };
      if (req.status === "pending") {
        if (needsSecondApproval(req)) {
          return { ok: true, nextStatus: "approved_1", deductDays: 0 };
        }
        return { ok: true, nextStatus: "approved", deductDays: deductionOf(req) };
      }
      if (req.status === "approved_1") {
        // 최종 승인은 admin만, 그리고 1차 결재자와 다른 사람이어야 한다 (이중 통제)
        if (actor.role !== "admin")
          return { ok: false, reason: "최종 승인은 관리자만 할 수 있습니다" };
        if (req.approverId && req.approverId === actor.id)
          return { ok: false, reason: "1차 결재자는 최종 승인할 수 없습니다" };
        return { ok: true, nextStatus: "approved", deductDays: deductionOf(req) };
      }
      return { ok: false, reason: "결재 대기 상태가 아닙니다" };
    }
  }
}

/** KST 기준 날짜 문자열(YYYY-MM-DD)의 요일 인덱스: 0=일 … 6=토 */
function dayOfWeekKst(dateStr: string): number {
  // date-only 문자열은 UTC 자정으로 파싱된다. KST는 UTC+9로 날짜가 바뀌지 않으므로
  // 요일 계산은 UTC 기준으로 안전하다
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

const EMPTY_HOLIDAYS: ReadonlySet<string> = new Set();

/** 해당 날짜가 휴무일(주말 또는 휴일 목록)인지 */
export function isNonWorkingDay(
  dateStr: string,
  holidays: ReadonlySet<string> = EMPTY_HOLIDAYS,
): boolean {
  const dow = dayOfWeekKst(dateStr);
  return dow === 0 || dow === 6 || holidays.has(dateStr);
}

/**
 * 휴가 일수 계산. 반차는 근무일 하루 0.5, 그 외에는 기간 내 근무일 수.
 * 근무일 = 평일(월~금)이면서 휴일(공휴일·전사 휴일) 목록에 없는 날.
 * start > end 또는 근무일이 없으면 0 — 호출부에서 유효성 오류로 처리한다
 */
export function countLeaveDays(
  type: LeaveType,
  startDate: string,
  endDate: string,
  holidays: ReadonlySet<string> = EMPTY_HOLIDAYS,
): number {
  if (type === "half") {
    return isNonWorkingDay(startDate, holidays) ? 0 : 0.5;
  }
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return 0;

  let days = 0;
  for (let t = start; t <= end; t += 24 * 60 * 60 * 1000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!isNonWorkingDay(d, holidays)) days++;
  }
  return days;
}

export { dayOfWeekKst };
