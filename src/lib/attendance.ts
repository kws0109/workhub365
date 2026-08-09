// 근태 집계 — 순수 함수 (단위 테스트 대상).
// 정책:
//  - 근무일 귀속: 체크인 시각의 KST 날짜 (자정 넘김 근무도 체크인 날짜)
//  - 주 경계: KST 월요일 00:00
//  - 경고: 주 48시간 이상 warn, 52시간 이상 over

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEKLY_WARN_MINUTES = 48 * 60;
export const WEEKLY_OVER_MINUTES = 52 * 60;

/** UTC 시각의 KST 날짜 문자열(YYYY-MM-DD) */
export function kstDateOf(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 해당 시각이 속한 KST 주의 월요일 날짜 문자열 */
export function weekStartKst(at: Date): string {
  const kst = new Date(at.getTime() + KST_OFFSET_MS);
  const dow = kst.getUTCDay(); // 0=일 … 6=토 (KST 기준 요일)
  const daysFromMonday = (dow + 6) % 7;
  return new Date(kst.getTime() - daysFromMonday * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** date(YYYY-MM-DD)가 weekStart(월요일)로 시작하는 KST 주에 속하는지 */
export function isInWeek(date: string, weekStart: string): boolean {
  const d = new Date(`${date}T00:00:00Z`).getTime();
  const w = new Date(`${weekStart}T00:00:00Z`).getTime();
  return d >= w && d < w + 7 * DAY_MS;
}

export type AttendanceLike = {
  date: string; // YYYY-MM-DD (KST 근무일)
  workedMinutes: number | null;
};

/** 주간 근무 분 합계 — 퇴근 처리된(workedMinutes 확정) 기록만 집계 */
export function aggregateWeeklyMinutes(
  records: AttendanceLike[],
  weekStart: string,
): number {
  return records
    .filter((r) => isInWeek(r.date, weekStart) && r.workedMinutes !== null)
    .reduce((sum, r) => sum + (r.workedMinutes ?? 0), 0);
}

export type OvertimeLevel = "ok" | "warn" | "over";

export function overtimeLevel(weeklyMinutes: number): OvertimeLevel {
  if (weeklyMinutes >= WEEKLY_OVER_MINUTES) return "over";
  if (weeklyMinutes >= WEEKLY_WARN_MINUTES) return "warn";
  return "ok";
}

/** 체크인·아웃 시각으로 근무 분 계산 (음수·역전은 0) */
export function workedMinutesBetween(checkIn: Date, checkOut: Date): number {
  return Math.max(0, Math.floor((checkOut.getTime() - checkIn.getTime()) / 60000));
}

// ---------------------------------------------------------------------------
// 인사팀 근태 정정 — 순수 함수 (단위 테스트 대상).
// ---------------------------------------------------------------------------

export const MAX_SHIFT_MINUTES = 24 * 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 'YYYY-MM-DD'(KST 날짜) + 'HH:mm'(KST 시각) → UTC Date. 형식 위반이면 null.
 *  KST는 서머타임 없는 고정 +9라 오프셋 감산으로 충분하다 (kstDateOf의 역함수) */
export function kstToUtc(dateStr: string, timeStr: string): Date | null {
  if (!DATE_RE.test(dateStr) || !TIME_RE.test(timeStr)) return null;
  const t = new Date(`${dateStr}T${timeStr}:00Z`).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t - KST_OFFSET_MS);
}

/** KST 날짜 문자열의 다음 날 — 자정 넘김 퇴근 입력용. 형식 위반이면 null */
export function nextKstDate(dateStr: string): string | null {
  if (!DATE_RE.test(dateStr)) return null;
  const t = new Date(`${dateStr}T00:00:00Z`).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + DAY_MS).toISOString().slice(0, 10);
}

export type AttendanceCorrectionInput = {
  checkInAt: Date;
  /** 필수 — 열린 기록 생성·유지 금지 */
  checkOutAt: Date;
  targetUserId: string;
};

export type AttendanceCorrectionCtx = {
  now: Date;
  actor: { id: string; hrEditor: boolean };
  /** 수정 대상이 열린 기록인지. true면 checkInAt은 lockedCheckInAt과 같아야 한다 */
  wasOpen: boolean;
  /** 열린 기록의 DB 상 체크인 시각 (생성 경로면 null) */
  lockedCheckInAt: Date | null;
};

export type AttendanceCorrectionResult =
  | { ok: true; date: string; workedMinutes: number }
  | { ok: false; reason: string };

/** 근태 정정 입력 검증 — 통과 시 귀속 근무일과 확정 근무 분을 파생 계산해 돌려준다 */
export function validateAttendanceCorrection(
  input: AttendanceCorrectionInput,
  ctx: AttendanceCorrectionCtx,
): AttendanceCorrectionResult {
  if (!ctx.actor.hrEditor) {
    return { ok: false, reason: "인사 정정 권한이 없습니다" };
  }
  // 본인 기록 셀프 정정 차단 — 이중 통제
  if (ctx.actor.id === input.targetUserId) {
    return { ok: false, reason: "본인 기록은 정정할 수 없습니다" };
  }
  // 근무 중인 기록은 퇴근 누락 정정만 허용하고 출근 시각 이동은 봉쇄한다
  if (
    ctx.wasOpen &&
    ctx.lockedCheckInAt &&
    input.checkInAt.getTime() !== ctx.lockedCheckInAt.getTime()
  ) {
    return { ok: false, reason: "근무 중인 기록은 출근 시각을 바꿀 수 없습니다" };
  }
  if (input.checkOutAt.getTime() <= input.checkInAt.getTime()) {
    return { ok: false, reason: "퇴근 시각은 출근 시각보다 뒤여야 합니다" };
  }
  if (input.checkInAt > ctx.now) {
    return { ok: false, reason: "미래 시각은 입력할 수 없습니다" };
  }
  if (input.checkOutAt > ctx.now) {
    return { ok: false, reason: "미래 시각은 입력할 수 없습니다" };
  }
  const worked = workedMinutesBetween(input.checkInAt, input.checkOutAt);
  if (worked > MAX_SHIFT_MINUTES) {
    return { ok: false, reason: "한 건의 근무는 24시간을 넘을 수 없습니다" };
  }
  // 근무일은 체크인 시각의 KST 날짜로 파생 재계산한다 (자정 오귀속 정정)
  return { ok: true, date: kstDateOf(input.checkInAt), workedMinutes: worked };
}
