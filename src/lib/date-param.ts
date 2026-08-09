// URL 쿼리 파라미터로 들어오는 날짜·월 문자열의 "달력 실재성" 검증.
// 형식 정규식만 통과시키면 2026-13-45 / 2026-02-31 / 2026-00 같은 값이 그대로 흘러가
// Date 연산의 RangeError나 Postgres date 캐스팅 오류로 화면 전체가 죽는다.
// 화면 진입부에서 이 헬퍼로 걸러내고 기본 기간으로 폴백하는 것이 규약이다.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 휴일 동기화(resyncHolidays)와 동일한 연도 범위 */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * 달력에 실재하는 "YYYY-MM-DD"인가.
 * 정규식만으로는 2026-02-31처럼 달을 넘겨 롤오버되는 값을 못 잡으므로
 * toISOString() 라운드트립으로 입력과 정규화 결과가 같은지까지 확인한다.
 */
export function isCalendarDate(s: string | null | undefined): s is string {
  if (!s || !DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === s;
}

/**
 * 달력에 실재하는 "YYYY-MM"인가 — 월은 01~12, 연도는 2000~2100.
 * 연도 상한이 있는 이유: 이 값이 공휴일 자동 수집(외부 API) 연도로도 쓰인다.
 */
export function isCalendarMonth(s: string | null | undefined): s is string {
  if (!s || !MONTH_RE.test(s)) return false;
  const year = Number(s.slice(0, 4));
  return year >= MIN_YEAR && year <= MAX_YEAR;
}
