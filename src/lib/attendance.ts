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
