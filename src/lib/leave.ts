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

// ─────────────────────────────────────────────────────────────
// HR 기록 정정 (R5.x) — 결재 흐름이 아니라 '기록 정정' 경로
// ─────────────────────────────────────────────────────────────

/** 신청 1건이 잔여 연차에서 차지하는 무게. approved & 비병가일 때만 days만큼.
 *  team/page.tsx의 `sum(days) filter (status='approved' and type <> 'sick')`와 대칭 */
export function leaveBalanceWeight(
  req: Pick<LeaveRequestLike, "status" | "type" | "days">,
): number {
  return req.status === "approved" && req.type !== "sick" ? req.days : 0;
}

/** 정정 전후의 잔여 연차 델타. 양수 = 추가 차감, 음수 = 복원 */
export function leaveBalanceDelta(
  before: Pick<LeaveRequestLike, "status" | "type" | "days">,
  after: Pick<LeaveRequestLike, "status" | "type" | "days">,
): number {
  return leaveBalanceWeight(after) - leaveBalanceWeight(before);
}

export type LeaveSnapshot = {
  userId: string;
  type: LeaveType;
  status: LeaveStatus;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  days: number;
  approverId?: string | null;
};

export type LeaveCorrectionInput = {
  type: LeaveType;
  startDate: string;
  endDate: string; // half면 startDate와 같아야 한다 (호출부가 정규화)
  /** 서버가 getHolidaySet + countLeaveDays로 재계산한 값 — 클라이언트 입력 아님 */
  days: number;
  /** true면 내용은 그대로 두고 상태만 cancelled로 (활성→취소 단방향) */
  cancel: boolean;
};

export type LeaveCorrectionResult =
  | { ok: true; after: LeaveSnapshot; balanceDelta: number }
  | { ok: false; reason: string };

/**
 * HR 기록 정정 — 결재 흐름이 아니라 '기록 정정' 경로.
 * transitionLeave의 불변식(재결재 불가·본인 pending만 취소·2단계 이중 통제)을
 * 건드리지 않기 위해 상태머신 '안'이 아니라 '옆'에 둔다. approverId는 절대 바꾸지 않는다.
 */
export function correctLeave(
  before: LeaveSnapshot,
  input: LeaveCorrectionInput,
  actor: { id: string; hrEditor: boolean },
): LeaveCorrectionResult {
  if (!actor.hrEditor)
    return { ok: false, reason: "인사 정정 권한이 없습니다" };
  // 셀프 정정 전면 금지 — transitionLeave의 '본인 신청 결재 불가'와 같은 이중 통제 원칙
  if (actor.id === before.userId)
    return { ok: false, reason: "본인 기록은 정정할 수 없습니다" };
  if (before.status === "rejected" || before.status === "cancelled")
    return { ok: false, reason: "종결된 신청은 정정할 수 없습니다" };

  let after: LeaveSnapshot;
  if (input.cancel) {
    // 활성 → 취소 단방향. 내용 필드는 무시한다 — 취소는 상태만 바꾼다
    after = { ...before, status: "cancelled" };
  } else {
    if (input.days <= 0)
      return {
        ok: false,
        reason: "기간에 근무일이 없거나 순서가 잘못되었습니다",
      };
    if (input.startDate > input.endDate)
      return { ok: false, reason: "기간 순서가 잘못되었습니다" };
    if (input.type === "half" && input.startDate !== input.endDate)
      return { ok: false, reason: "반차는 하루만 지정할 수 있습니다" };
    // 상태는 절대 상향하지 않는다. approverId·userId도 그대로 승계된다
    after = {
      ...before,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      days: input.days,
      status: before.status,
    };
  }

  // 일수 증가 단방향 금지 — 임계(needsSecondApproval) 통과 여부가 아니라 증가 자체를 막는다.
  // 임계 비교로는 이미 4일인 승인 건을 40일로 늘리는 경로가 열린 채 남는다
  if (before.status !== "pending" && after.days > before.days)
    return {
      ok: false,
      reason:
        "결재된 신청의 일수는 늘릴 수 없습니다. 정정 취소 후 재신청하세요",
    };

  return { ok: true, after, balanceDelta: leaveBalanceDelta(before, after) };
}
