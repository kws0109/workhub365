// 일정 주간 그리드(B2, R8.2)의 날짜·배치 순수 로직 — UI와 분리해 단위 테스트를 붙인다.
// 날짜 문자열은 전부 KST 기준 "YYYY-MM-DD" (Graph는 Prefer 헤더로 KST 문자열을 준다)

export const GRID_START_HOUR = 8;
/** 그리드 마지막 행의 끝 — 08~18시 라벨 11개 = 08:00~19:00 창 (528px) */
export const GRID_END_HOUR = 19;
export const PX_PER_HOUR = 48;

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 해당 날짜가 속한 주의 월요일 (일요일은 지난 월요일로) */
export function mondayOf(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=일
  return addDaysIso(iso, day === 0 ? -6 : 1 - day);
}

/** 월~금 5일 */
export function weekdaysOf(mondayIso: string): string[] {
  return Array.from({ length: 5 }, (_, i) => addDaysIso(mondayIso, i));
}

/** "2026년 8월 10일 – 14일" (월 경계를 넘으면 "8월 31일 – 9월 4일" 형태) */
export function weekRangeLabel(mondayIso: string): string {
  const fri = addDaysIso(mondayIso, 4);
  const [y, m, d] = mondayIso.split("-").map(Number);
  const [fy, fm, fd] = fri.split("-").map(Number);
  const head = `${y}년 ${m}월 ${d}일`;
  if (y === fy && m === fm) return `${head} – ${fd}일`;
  if (y === fy) return `${head} – ${fm}월 ${fd}일`;
  return `${head} – ${fy}년 ${fm}월 ${fd}일`;
}

/**
 * KST datetime 문자열("YYYY-MM-DDTHH:mm:ss…") → 그리드 픽셀 배치.
 * 시작일 컬럼에만 배치(다일 이벤트 단순화)하고 08~19시 창으로 클램프.
 * 창 밖이면 null.
 */
export function eventBlock(
  startDateTime: string,
  endDateTime: string,
  dayIso: string,
): { top: number; height: number } | null {
  if (!startDateTime.startsWith(dayIso)) return null;
  const toHours = (s: string) =>
    Number(s.slice(11, 13)) + Number(s.slice(14, 16)) / 60;
  const start = toHours(startDateTime);
  // 종료가 다음 날로 넘어가면 창 끝까지로 본다
  const end = endDateTime.startsWith(dayIso) ? toHours(endDateTime) : GRID_END_HOUR;
  const clampedStart = Math.max(start, GRID_START_HOUR);
  const clampedEnd = Math.min(end, GRID_END_HOUR);
  if (clampedEnd <= clampedStart) return null;
  return {
    top: (clampedStart - GRID_START_HOUR) * PX_PER_HOUR,
    // 최소 높이 18px — 15분 미만 이벤트도 제목이 보이게. -2는 블록 간 시각 간격
    height: Math.max(18, (clampedEnd - clampedStart) * PX_PER_HOUR - 2),
  };
}
