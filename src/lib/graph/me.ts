import "server-only";

import { delegatedGraphFetch } from "./delegated";

// 홈 대시보드 M365 위젯(R7.4) — 로그인 사용자 본인 데이터만 (위임 토큰)

/** 받은 편지함 안읽은 메일 수 — 폴더 메타데이터 1건 조회라 목록 조회보다 싸다 */
export async function getInboxUnreadCount(token: string): Promise<number> {
  const folder = await delegatedGraphFetch<{ unreadItemCount: number }>(
    token,
    "/me/mailFolders/inbox?$select=unreadItemCount",
  );
  return folder.unreadItemCount;
}

export type TodayEvent = {
  subject: string | null;
  isAllDay: boolean;
  /** Prefer 헤더로 Asia/Seoul 기준 "YYYY-MM-DDTHH:mm:ss…" */
  start: { dateTime: string };
  end: { dateTime: string };
};

/** 주간(월~토 미포함) 일정 — 일정 화면(B2)용. calendarView가 반복 일정을 전개한다 */
export async function getWeekEvents(
  token: string,
  mondayKst: string,
  endExclusiveKst: string,
): Promise<TodayEvent[]> {
  const startUtc = new Date(`${mondayKst}T00:00:00+09:00`).toISOString();
  const endUtc = new Date(`${endExclusiveKst}T00:00:00+09:00`).toISOString();
  const path =
    `/me/calendarView?startDateTime=${startUtc}&endDateTime=${endUtc}` +
    `&$select=subject,start,end,isAllDay&$orderby=start/dateTime&$top=100`;
  const page = await delegatedGraphFetch<{ value: TodayEvent[] }>(token, path, {
    headers: { Prefer: 'outlook.timezone="Asia/Seoul"' },
  });
  return page.value;
}

/** 오늘(KST) 일정 최대 5건 — calendarView는 반복 일정을 전개해 준다 */
export async function getTodayEvents(
  token: string,
  todayKst: string,
): Promise<TodayEvent[]> {
  const startUtc = new Date(`${todayKst}T00:00:00+09:00`).toISOString();
  const endUtc = new Date(
    new Date(`${todayKst}T00:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();
  const path =
    `/me/calendarView?startDateTime=${startUtc}&endDateTime=${endUtc}` +
    `&$select=subject,start,end,isAllDay&$orderby=start/dateTime&$top=5`;
  const page = await delegatedGraphFetch<{ value: TodayEvent[] }>(token, path, {
    headers: { Prefer: 'outlook.timezone="Asia/Seoul"' },
  });
  return page.value;
}
