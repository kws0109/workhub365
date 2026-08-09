import Link from "next/link";
import { requireSession } from "@/lib/auth-helpers";
import { kstDateOf } from "@/lib/attendance";
import { addDaysIso } from "@/lib/calendar-week";
import { isCalendarDate } from "@/lib/date-param";
import { GraphError } from "@/lib/graph/client";
import { getDelegatedGraphToken } from "@/lib/graph/delegated";
import {
  getMyRoomEvents,
  getRooms,
  getRoomSchedules,
  type MyRoomEvent,
  type RoomInfo,
} from "@/lib/graph/rooms";
import {
  canBook,
  eventSlotRange,
  eventTimeLabel,
  mergeBlocks,
  overlayMine,
  roomDayLabel,
  ROOM_SLOT_COUNT,
  ROOM_START_HOUR,
  slotsFromView,
  type RoomSlot,
} from "@/lib/room-schedule";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader, SourceChip } from "@/components/ui";
import { bookRoom, cancelRoomBooking } from "./actions";

export const metadata = { title: "회의실 예약" };

// 회의실 가용성 그리드 + 예약(B6, R8.6) — 목록은 app-only, 가용성·예약은 위임.
// 강등 2단: ① 리소스 사서함 0개 → 세팅 안내 카드 ② 위임 토큰 없음/미동의 → 목록만 + 재로그인 안내.
// 어느 경우에도 페이지는 죽지 않는다.

const HOURS = Array.from({ length: ROOM_SLOT_COUNT }, (_, i) => ROOM_START_HOUR + i);

export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; book?: string; hour?: string }>;
}) {
  await requireSession();
  const sp = await searchParams;
  const today = kstDateOf(new Date());
  // 형식만 맞고 달력에 없는 date(2026-13-45)는 조용히 오늘로 폴백 —
  // 아래 addDaysIso는 헤더 JSX 조립 시점에 즉시 평가되므로 여기서 막지 않으면
  // 위 강등 설계("어느 경우에도 페이지는 죽지 않는다")가 그대로 무너진다
  const date = isCalendarDate(sp.date) ? sp.date : today;

  // 1) 회의실 목록 (app-only) — 실패(오류 카드)와 빈 배열(세팅 안내)을 구분한다
  let rooms: RoomInfo[] | null = null;
  let roomsError: string | null = null;
  try {
    rooms = await getRooms();
  } catch (e) {
    roomsError =
      e instanceof GraphError ? `${e.code}: ${e.message}` : "알 수 없는 오류";
  }

  // 2) 가용성·내 예약 (위임) — 토큰 없음/스코프 미동의(403)면 목록만 남기고 강등
  const token = await getDelegatedGraphToken();
  let schedules: Map<string, string> | null = null;
  let myEvents: MyRoomEvent[] | null = null;
  let needsRelogin = !token;
  let delegatedError: string | null = null;
  if (token && rooms && rooms.length > 0) {
    try {
      [schedules, myEvents] = await Promise.all([
        getRoomSchedules(token, rooms.map((r) => r.emailAddress), date),
        getMyRoomEvents(token, date, rooms),
      ]);
    } catch (e) {
      if (e instanceof GraphError && (e.status === 401 || e.status === 403)) {
        needsRelogin = true;
      } else {
        delegatedError =
          e instanceof GraphError ? `${e.code}: ${e.message}` : "알 수 없는 오류";
      }
    }
  }

  // 회의실별 슬롯 상태 (가용성 + 내 예약 덧씌움)
  const slotsByRoom = new Map<string, RoomSlot[]>();
  if (rooms && schedules) {
    for (const room of rooms) {
      const base = slotsFromView(schedules.get(room.emailAddress.toLowerCase()));
      const mineRanges = (myEvents ?? [])
        .filter((ev) => ev.roomEmail === room.emailAddress.toLowerCase())
        .map((ev) => eventSlotRange(ev.start.dateTime, ev.end.dateTime, date))
        .filter((r): r is { start: number; end: number } => r !== null);
      slotsByRoom.set(room.emailAddress, overlayMine(base, mineRanges));
    }
  }

  // 인라인 예약 폼(?book=이메일&hour=N) — 슬롯이 아직 비어 있을 때만 연다
  const bookTarget = rooms?.find(
    (r) => r.emailAddress.toLowerCase() === (sp.book ?? "").toLowerCase(),
  );
  const bookHour = Number(sp.hour);
  const bookSlots = bookTarget ? slotsByRoom.get(bookTarget.emailAddress) : undefined;
  const bookingOpen =
    !!bookTarget && !!bookSlots && canBook(bookSlots, bookHour, 1);
  const canTwoHours = !!bookSlots && canBook(bookSlots, bookHour, 2);

  return (
    <div className="max-w-[1240px]">
      <PageHeader
        title="회의실 예약"
        subtitle={
          <SourceChip brand="outlook">Outlook 리소스 사서함 연동</SourceChip>
        }
        actions={
          <>
            <Link
              href="/rooms"
              className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium transition hover:bg-canvas"
            >
              오늘
            </Link>
            <Link
              href={`/rooms?date=${addDaysIso(date, -1)}`}
              aria-label="전날"
              className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] transition hover:bg-canvas"
            >
              ◀
            </Link>
            <span className="text-sm font-semibold tabular-nums">
              {roomDayLabel(date)}
              {date === today && " · 오늘"}
            </span>
            <Link
              href={`/rooms?date=${addDaysIso(date, 1)}`}
              aria-label="다음 날"
              className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] transition hover:bg-canvas"
            >
              ▶
            </Link>
          </>
        }
      />

      {roomsError ? (
        <Card className="mt-5 border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p className="font-semibold">회의실 목록 조회에 실패했습니다</p>
          <p className="mt-1">{roomsError}</p>
        </Card>
      ) : rooms && rooms.length === 0 ? (
        // 강등 ① — 테넌트에 리소스 사서함이 없다 (R8.6)
        <Card className="mt-5 border-dashed p-6 text-sm text-ink-secondary">
          <p className="font-semibold text-ink">
            등록된 회의실(리소스 사서함)이 없습니다
          </p>
          <p className="mt-2">
            회의실 예약을 사용하려면 M365 관리센터에서 리소스 사서함(회의실)을
            먼저 생성해야 합니다. 리소스 사서함 생성은 Graph API가 아닌{" "}
            <span className="font-semibold">관리센터 영역</span>이라 이 화면에서
            만들 수 없습니다.
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            관리센터 → 리소스 → 회의실 및 장비에서 추가하면 이 화면이 가용성
            그리드로 전환됩니다
          </p>
        </Card>
      ) : rooms ? (
        <>
          {/* 강등 ② — 위임 토큰 없음/스코프 미동의: 목록만 표시 */}
          {needsRelogin && (
            <Card className="mt-5 border-dashed p-4 text-[13px] text-ink-secondary">
              가용성 확인과 예약에는{" "}
              <span className="font-semibold">다시 로그인</span>이 필요합니다 —
              Microsoft 동의 화면에서 일정 쓰기(Calendars.ReadWrite) 권한을
              승인해 주세요 (사이드바 하단 로그아웃 → 재로그인)
            </Card>
          )}
          {delegatedError && (
            <Card className="mt-5 border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
              가용성 조회에 실패해 회의실 목록만 표시합니다 — {delegatedError}
            </Card>
          )}

          {/* 가용성 그리드 */}
          <Card className="mt-5 overflow-hidden">
            <div className="flex border-b border-fill">
              <div className="w-[180px] flex-none px-4 py-2 text-xs font-medium text-ink-muted">
                회의실
              </div>
              <div className="grid flex-1 grid-cols-8">
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="border-l border-fill py-2 pl-1.5 text-[11px] tabular-nums text-ink-muted"
                  >
                    {String(h).padStart(2, "0")}:00
                  </div>
                ))}
              </div>
            </div>
            {rooms.map((room) => {
              const slots = slotsByRoom.get(room.emailAddress);
              return (
                <div
                  key={room.emailAddress}
                  className="flex border-b border-fill last:border-b-0"
                >
                  <div className="w-[180px] flex-none px-4 py-3">
                    <p className="truncate text-[13px] font-semibold">
                      {room.displayName}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-muted">
                      {room.capacity != null
                        ? `수용 ${room.capacity}인`
                        : "수용 인원 미지정"}
                    </p>
                  </div>
                  <div
                    className="grid flex-1 grid-cols-8"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(to right, var(--color-fill) 0, var(--color-fill) 1px, transparent 1px, transparent 12.5%)",
                    }}
                  >
                    {slots ? (
                      <>
                        {slots.map((s, i) =>
                          s === "free" ? (
                            <Link
                              key={i}
                              href={`/rooms?date=${date}&book=${encodeURIComponent(room.emailAddress)}&hour=${ROOM_START_HOUR + i}`}
                              aria-label={`${room.displayName} ${ROOM_START_HOUR + i}시 예약`}
                              title={`${String(ROOM_START_HOUR + i).padStart(2, "0")}:00 예약`}
                              className="min-h-11 transition hover:bg-canvas"
                              style={{ gridColumn: `${i + 1} / span 1`, gridRow: 1 }}
                            />
                          ) : null,
                        )}
                        {mergeBlocks(slots).map((b) => (
                          <div
                            key={b.start}
                            className={`m-1 overflow-hidden rounded-md px-2 py-1 text-[11.5px] font-semibold ${
                              b.status === "mine"
                                ? "bg-ink text-white"
                                : "border border-blue-200 bg-blue-50 text-blue-700"
                            }`}
                            style={{
                              gridColumn: `${b.start + 1} / span ${b.span}`,
                              gridRow: 1,
                            }}
                          >
                            <span className="block truncate">
                              {b.status === "mine" ? "내 예약" : "예약됨"}
                            </span>
                          </div>
                        ))}
                      </>
                    ) : (
                      // 위임 강등 — 가용성 없이 목록만 (셀 클릭 불가)
                      <div className="col-span-8 min-h-11" />
                    )}
                  </div>
                </div>
              );
            })}
          </Card>

          {/* 인라인 예약 폼 — 빈 슬롯 클릭으로 진입 */}
          {bookingOpen && bookTarget && (
            <Card className="mt-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold">
                    회의실 예약 — {bookTarget.displayName}
                  </h2>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {roomDayLabel(date)} · {String(bookHour).padStart(2, "0")}:00
                    시작 · Outlook 초대와 함께 예약됩니다
                  </p>
                </div>
                <Link
                  href={`/rooms?date=${date}`}
                  className="text-xs text-ink-muted hover:underline"
                >
                  닫기
                </Link>
              </div>
              <ActionForm action={bookRoom} className="mt-3">
                <input type="hidden" name="roomEmail" value={bookTarget.emailAddress} />
                <input type="hidden" name="dateKst" value={date} />
                <input type="hidden" name="startHour" value={bookHour} />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    name="subject"
                    required
                    maxLength={200}
                    placeholder="회의 제목"
                    className="w-64 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-line-strong"
                  />
                  <select
                    name="durationHours"
                    defaultValue="1"
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px]"
                  >
                    <option value="1">
                      1시간 ({bookHour}:00–{bookHour + 1}:00)
                    </option>
                    {canTwoHours && (
                      <option value="2">
                        2시간 ({bookHour}:00–{bookHour + 2}:00)
                      </option>
                    )}
                  </select>
                  <button
                    type="submit"
                    className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white transition hover:bg-ink-body"
                  >
                    예약
                  </button>
                </div>
              </ActionForm>
            </Card>
          )}

          {/* 내 예약 + 범례 */}
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold">내 예약</h2>
              {!myEvents ? (
                <p className="mt-3 text-[13px] text-ink-muted">
                  일정 권한 동의(재로그인) 후 표시됩니다
                </p>
              ) : myEvents.length === 0 ? (
                <p className="mt-3 text-[13px] text-ink-muted">
                  선택일부터 7일간 회의실 예약이 없습니다
                </p>
              ) : (
                <div className="mt-2 flex flex-col">
                  {myEvents.map((ev, i) => (
                    <div
                      key={ev.id}
                      className={`flex items-center gap-3 py-2.5 text-[13px] ${
                        i > 0 ? "border-t border-fill" : ""
                      }`}
                    >
                      <span className="w-[110px] flex-none tabular-nums text-ink-secondary">
                        {eventTimeLabel(ev.start.dateTime, ev.end.dateTime)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">
                          {ev.subject ?? "(제목 없음)"}
                        </span>
                        <span className="ml-1.5 text-ink-muted">{ev.roomName}</span>
                      </span>
                      <Badge tone="success">확정</Badge>
                      <ActionForm action={cancelRoomBooking}>
                        <input type="hidden" name="eventId" value={ev.id} />
                        <input type="hidden" name="label" value={ev.subject ?? ""} />
                        <button
                          type="submit"
                          className="text-[11px] text-ink-muted hover:underline"
                        >
                          취소
                        </button>
                      </ActionForm>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card className="p-5">
              <h2 className="text-[13px] font-semibold">범례 · 동작</h2>
              <div className="mt-2 flex flex-col gap-1.5 text-xs text-ink-secondary">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[3px] border border-blue-200 bg-blue-50" />
                  예약됨
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-ink" />내 예약
                </span>
                <span>빈 시간대를 클릭하면 Outlook 초대와 함께 예약됩니다</span>
                <span>09~17시 · 1시간 단위(최대 2시간) · 취소는 내 일정에서 삭제됩니다</span>
              </div>
            </Card>
          </div>
        </>
      ) : null}

      <p className="mt-3 text-xs text-ink-muted">
        회의실 목록은 테넌트 리소스 사서함, 가용성은 Outlook getSchedule 기준 ·
        예약 생성·취소는 본인 계정 위임 권한으로 실행되며 감사 로그에 기록됩니다
      </p>
    </div>
  );
}
