import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { holidays } from "@/db/schema";

// 공휴일 소스: Nager.Date 공개 API (한국, 대체공휴일 포함, 인증 불필요).
// 연도 단위로 DB에 캐시하고, 실패 시 기존 캐시로 동작한다.

const NAGER_BASE = "https://date.nager.at/api/v3/PublicHolidays";

type NagerHoliday = { date: string; localName: string };

/** 해당 연도의 공휴일을 API에서 받아 DB에 upsert. 성공 시 반영 건수 반환 */
export async function syncPublicHolidays(year: number): Promise<number> {
  const res = await fetch(`${NAGER_BASE}/${year}/KR`, {
    // 공휴일은 자주 바뀌지 않는다 — 요청 레벨 캐시 1일
    next: { revalidate: 86400 },
  });
  if (!res.ok) {
    throw new Error(`공휴일 API 응답 오류 (${res.status})`);
  }
  const list = (await res.json()) as NagerHoliday[];
  let count = 0;
  for (const h of list) {
    await db
      .insert(holidays)
      .values({ date: h.date, name: h.localName, source: "public" })
      .onConflictDoUpdate({
        target: holidays.date,
        // 관리자가 설정한 전사 휴일(company)을 공휴일 동기화가 덮어쓰지 않도록
        // 이름만 갱신하고 source는 기존 값 유지
        set: { name: h.localName },
      });
    count++;
  }
  return count;
}

/** 연도별 공휴일 캐시가 없으면 1회 자동 동기화 (실패해도 페이지는 살아 있어야 한다) */
export async function ensurePublicHolidays(year: number): Promise<void> {
  const existing = await db.query.holidays.findFirst({
    where: and(
      eq(holidays.source, "public"),
      gte(holidays.date, `${year}-01-01`),
      lte(holidays.date, `${year}-12-31`),
    ),
  });
  if (existing) return;
  try {
    await syncPublicHolidays(year);
  } catch (e) {
    console.error(`공휴일 자동 동기화 실패 (${year}):`, e);
  }
}

export type HolidayRow = {
  id: string;
  date: string;
  name: string;
  source: "public" | "company";
};

/** 기간 내 휴일 목록 (캘린더 표시·관리 UI용) */
export async function getHolidaysBetween(
  from: string,
  to: string,
): Promise<HolidayRow[]> {
  const rows = await db.query.holidays.findMany({
    where: and(gte(holidays.date, from), lte(holidays.date, to)),
    orderBy: holidays.date,
  });
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    name: r.name,
    source: r.source,
  }));
}

/** 기간 내 휴일 날짜 Set (countLeaveDays 등 계산용) */
export async function getHolidaySet(
  from: string,
  to: string,
): Promise<Set<string>> {
  return new Set((await getHolidaysBetween(from, to)).map((h) => h.date));
}
