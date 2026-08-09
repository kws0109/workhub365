import Link from "next/link";
import { requireSession } from "@/lib/auth-helpers";
import { kstDateOf } from "@/lib/attendance";
import {
  addDaysIso,
  eventBlock,
  GRID_END_HOUR,
  GRID_START_HOUR,
  mondayOf,
  PX_PER_HOUR,
  weekdaysOf,
  weekRangeLabel,
} from "@/lib/calendar-week";
import { isCalendarDate } from "@/lib/date-param";
import { GraphError } from "@/lib/graph/client";
import { getDelegatedGraphToken } from "@/lib/graph/delegated";
import { getWeekEvents, type TodayEvent } from "@/lib/graph/me";
import { Card, PageHeader, SourceChip } from "@/components/ui";
import { NowLine } from "@/components/now-line";

export const metadata = { title: "일정" };

// 일정 주간 그리드(B2, R8.2) — 위임 calendarView 읽기 전용.
// "새 일정"은 Outlook 딥링크 위임(쓰기 스코프 없음). 목업의 3색 범례는
// calendarView 단일 소스라 1:1 대응이 없어 단일 톤으로 단순화(feature-map 재량).

const DAY_LABEL = ["월", "화", "수", "목", "금"] as const;
const HOURS = Array.from(
  { length: GRID_END_HOUR - GRID_START_HOUR },
  (_, i) => GRID_START_HOUR + i,
);

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireSession();
  const { week } = await searchParams;
  const today = kstDateOf(new Date());
  // 형식만 맞고 달력에 없는 week(2026-13-45)은 조용히 이번 주로 폴백한다 —
  // 사용자는 기본 기간이 뜬 것으로 잘못된 값을 알 수 있고, 페이지는 죽지 않는다
  const monday = mondayOf(isCalendarDate(week) ? week : today);
  const days = weekdaysOf(monday);

  const token = await getDelegatedGraphToken();
  let events: TodayEvent[] | null = null;
  let fetchError: string | null = null;
  if (token) {
    try {
      events = await getWeekEvents(token, monday, addDaysIso(monday, 5));
    } catch (e) {
      fetchError =
        e instanceof GraphError ? `${e.code}: ${e.message}` : "알 수 없는 오류";
    }
  }

  const timed = (dayIso: string) =>
    (events ?? [])
      .filter((e) => !e.isAllDay)
      .map((e) => ({ e, block: eventBlock(e.start.dateTime, e.end.dateTime, dayIso) }))
      .filter((x): x is { e: TodayEvent; block: { top: number; height: number } } =>
        x.block !== null,
      );
  const allDay = (dayIso: string) =>
    (events ?? []).filter(
      (e) => e.isAllDay && e.start.dateTime.startsWith(dayIso),
    );

  return (
    <div className="max-w-[1240px]">
      <PageHeader
        title="일정"
        subtitle={<SourceChip brand="outlook">Outlook 캘린더 연동</SourceChip>}
        actions={
          <>
            <Link
              href="/calendar"
              className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium transition hover:bg-canvas"
            >
              오늘
            </Link>
            <Link
              href={`/calendar?week=${addDaysIso(monday, -7)}`}
              aria-label="지난주"
              className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] transition hover:bg-canvas"
            >
              ◀
            </Link>
            <span className="text-sm font-semibold">{weekRangeLabel(monday)}</span>
            <Link
              href={`/calendar?week=${addDaysIso(monday, 7)}`}
              aria-label="다음주"
              className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] transition hover:bg-canvas"
            >
              ▶
            </Link>
            <a
              href="https://outlook.office.com/calendar/action/compose"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white transition hover:bg-ink-body"
            >
              새 일정
            </a>
          </>
        }
      />

      {!token ? (
        <Card className="mt-5 border-dashed p-6 text-sm text-ink-secondary">
          일정을 보려면 <span className="font-semibold">다시 로그인</span>이
          필요합니다 — 로그인 시 Microsoft 동의 화면에서 일정 읽기 권한을 승인해
          주세요 (사이드바 하단 로그아웃 → 재로그인)
        </Card>
      ) : fetchError ? (
        <Card className="mt-5 border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p className="font-semibold">일정 조회에 실패했습니다</p>
          <p className="mt-1">{fetchError}</p>
        </Card>
      ) : (
        <Card className="mt-5 overflow-hidden">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-[56px_repeat(5,minmax(0,1fr))] border-b border-fill">
            <div />
            {days.map((d, i) => {
              const isToday = d === today;
              return (
                <div key={d} className="border-l border-fill p-2.5 text-center">
                  <span
                    className={`inline-block rounded-full px-3 py-1 text-[13px] font-medium ${
                      isToday ? "bg-ink text-white" : ""
                    }`}
                  >
                    {DAY_LABEL[i]} {Number(d.slice(5, 7))}/{Number(d.slice(8, 10))}
                  </span>
                  {allDay(d).map((e, j) => (
                    <p
                      key={j}
                      className="mt-1 truncate rounded-md bg-fill px-1.5 py-0.5 text-[11px] text-ink-sub"
                      title={e.subject ?? undefined}
                    >
                      종일 · {e.subject ?? "(제목 없음)"}
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
          {/* 타임 그리드 */}
          <div className="grid grid-cols-[56px_repeat(5,minmax(0,1fr))]">
            <div>
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="-translate-y-1.5 pr-2 text-right text-[11px] text-ink-muted"
                  style={{ height: PX_PER_HOUR }}
                >
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>
            {days.map((d) => {
              const isToday = d === today;
              return (
                <div
                  key={d}
                  className={`relative border-l border-fill ${isToday ? "bg-canvas" : ""}`}
                  style={{
                    height: (GRID_END_HOUR - GRID_START_HOUR) * PX_PER_HOUR,
                    backgroundImage:
                      "repeating-linear-gradient(to bottom, var(--color-fill) 0, var(--color-fill) 1px, transparent 1px, transparent 48px)",
                  }}
                >
                  {timed(d).map(({ e, block }, j) => (
                    <div
                      key={j}
                      className="absolute inset-x-1 overflow-hidden rounded-md border border-blue-200 bg-blue-100 px-2 py-0.5"
                      style={{ top: block.top, height: block.height }}
                      title={e.subject ?? undefined}
                    >
                      <p className="truncate text-xs font-semibold text-blue-900">
                        {e.subject ?? "(제목 없음)"}
                      </p>
                      <p className="truncate text-[11px] text-blue-900/75">
                        {e.start.dateTime.slice(11, 16)} –{" "}
                        {e.end.dateTime.slice(11, 16)}
                      </p>
                    </div>
                  ))}
                  {isToday && (
                    <NowLine
                      startHour={GRID_START_HOUR}
                      endHour={GRID_END_HOUR}
                      pxPerHour={PX_PER_HOUR}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        본인 캘린더 일정이 Microsoft Graph로 동기화됩니다 · 종일·반복 일정 포함,
        08~19시 창 밖 일정은 표시되지 않습니다
      </p>
    </div>
  );
}
