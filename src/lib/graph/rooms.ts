import "server-only";

import { cachedGraph } from "./cache";
import {
  GraphError,
  graphGetAllPaged,
  REQUEST_TIMEOUT_MS,
  toGraphTimeout,
} from "./client";
import { delegatedGraphFetch } from "./delegated";
import { kstHourToUtcIso } from "@/lib/room-schedule";

// 회의실 예약(B6, R8.6) — 회의실 목록은 app-only(테넌트 리소스 조회),
// 가용성 조회·예약 생성·취소는 위임(본인 캘린더 쓰기).
// 예약 생성은 "쓰기 위임의 유일한 예외"(feature-map 결정) — 관리 액션이 아닌 개인 일정 쓰기다.

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export type RoomInfo = {
  id: string;
  displayName: string;
  emailAddress: string;
  capacity: number | null;
};

/**
 * 리소스 사서함(회의실) 목록 — app-only.
 * 빈 배열 = 테넌트에 회의실 없음(세팅 안내 카드로 강등), 실패는 throw로 구분한다.
 * /places는 Place.Read.All 미부여 시 403이 아니라 메시지 없는 401을 준다(실측) —
 * 권한 안내로 변환해 오류 카드가 조치 방법을 말하게 한다.
 */
export async function getRooms(): Promise<RoomInfo[]> {
  return cachedGraph("graph:rooms", 60_000, async () => {
    const { items } = await graphGetAllPaged<{
      id: string;
      displayName?: string | null;
      emailAddress?: string | null;
      capacity?: number | null;
    }>("/places/microsoft.graph.room?$top=100", { maxPages: 5 }).catch(
      (e: unknown) => {
        if (e instanceof GraphError && (e.status === 401 || e.status === 403)) {
          throw new GraphError(
            e.status,
            "place_permission_required",
            "앱 등록에 Place.Read.All(application) 권한과 관리자 동의가 필요합니다",
          );
        }
        throw e;
      },
    );
    return items
      .filter((r): r is typeof r & { emailAddress: string } => !!r.emailAddress)
      .map((r) => ({
        id: r.id,
        displayName: r.displayName ?? r.emailAddress,
        emailAddress: r.emailAddress,
        capacity: r.capacity ?? null,
      }));
  });
}

// getSchedule은 요청당 schedules 20개 상한 — 초과분은 나눠 보낸다
const GET_SCHEDULE_BATCH = 20;

/**
 * 회의실 가용성(위임) — email(소문자) → availabilityView 문자열.
 * 09~17시 KST, 1시간 간격 = 8문자('0'=free). 개별 조회 실패 항목은 결측으로 남고
 * slotsFromView가 보수적으로 busy 처리한다.
 */
export async function getRoomSchedules(
  token: string,
  roomEmails: string[],
  dateKst: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < roomEmails.length; i += GET_SCHEDULE_BATCH) {
    const batch = roomEmails.slice(i, i + GET_SCHEDULE_BATCH);
    const res = await delegatedGraphFetch<{
      value: { scheduleId: string; availabilityView?: string }[];
    }>(token, "/me/calendar/getSchedule", {
      method: "POST",
      body: JSON.stringify({
        schedules: batch,
        startTime: { dateTime: `${dateKst}T09:00:00`, timeZone: "Asia/Seoul" },
        endTime: { dateTime: `${dateKst}T17:00:00`, timeZone: "Asia/Seoul" },
        availabilityViewInterval: 60,
      }),
    });
    for (const s of res.value) {
      if (s.availabilityView) out.set(s.scheduleId.toLowerCase(), s.availabilityView);
    }
  }
  return out;
}

/**
 * 예약 생성(위임) — 본인 캘린더에 회의실을 resource 참석자 + 장소로 넣은 이벤트를 만든다.
 * 리소스 사서함이 초대를 받아 자동 수락/거절한다(Outlook 초대 흐름).
 */
export async function createRoomEvent(
  token: string,
  opts: {
    roomEmail: string;
    roomName: string;
    dateKst: string;
    startHour: number;
    durationHours: number;
    subject: string;
  },
): Promise<{ id: string }> {
  const at = (h: number) => `${opts.dateKst}T${String(h).padStart(2, "0")}:00:00`;
  return delegatedGraphFetch<{ id: string }>(token, "/me/events", {
    method: "POST",
    body: JSON.stringify({
      subject: opts.subject,
      start: { dateTime: at(opts.startHour), timeZone: "Asia/Seoul" },
      end: { dateTime: at(opts.startHour + opts.durationHours), timeZone: "Asia/Seoul" },
      location: {
        displayName: opts.roomName,
        locationEmailAddress: opts.roomEmail,
        locationType: "conferenceRoom",
      },
      attendees: [
        {
          emailAddress: { address: opts.roomEmail, name: opts.roomName },
          type: "resource",
        },
      ],
    }),
  });
}

/**
 * 예약 취소 = 내 이벤트 삭제(위임). 위임 토큰은 /me 범위라 본인 캘린더 밖은 지울 수 없다.
 * DELETE는 204 빈 본문을 돌려주는데 delegatedGraphFetch는 json 파싱을 전제하므로 직접 호출한다.
 */
export async function cancelEvent(token: string, eventId: string): Promise<void> {
  const res = await fetch(
    `${GRAPH_BASE}/me/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  ).catch(toGraphTimeout);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new GraphError(
      res.status,
      body.error?.code ?? String(res.status),
      body.error?.message ?? res.statusText,
    );
  }
  await res.body?.cancel();
}

export type MyRoomEvent = {
  id: string;
  subject: string | null;
  /** Prefer 헤더로 Asia/Seoul 기준 "YYYY-MM-DDTHH:mm:ss…" */
  start: { dateTime: string };
  end: { dateTime: string };
  /** 매칭된 회의실 이메일(소문자) */
  roomEmail: string;
  roomName: string;
};

type RawCalendarEvent = {
  id: string;
  subject: string | null;
  start: { dateTime: string };
  end: { dateTime: string };
  location?: { locationEmailAddress?: string | null } | null;
  attendees?: {
    type?: string;
    emailAddress?: { address?: string | null } | null;
  }[];
};

/**
 * 내 회의실 예약(위임) — dateKst부터 7일간 calendarView 중
 * 장소 또는 resource 참석자가 회의실 목록과 일치하는 이벤트만.
 */
export async function getMyRoomEvents(
  token: string,
  dateKst: string,
  rooms: RoomInfo[],
): Promise<MyRoomEvent[]> {
  const byEmail = new Map(rooms.map((r) => [r.emailAddress.toLowerCase(), r]));
  const startUtc = kstHourToUtcIso(dateKst, 0);
  const endUtc = kstHourToUtcIso(dateKst, 24 * 7);
  const path =
    `/me/calendarView?startDateTime=${startUtc}&endDateTime=${endUtc}` +
    `&$select=id,subject,start,end,location,attendees&$orderby=start/dateTime&$top=100`;
  const page = await delegatedGraphFetch<{ value: RawCalendarEvent[] }>(
    token,
    path,
    { headers: { Prefer: 'outlook.timezone="Asia/Seoul"' } },
  );

  const out: MyRoomEvent[] = [];
  for (const ev of page.value) {
    const candidates = [
      ev.location?.locationEmailAddress,
      ...(ev.attendees ?? [])
        .filter((a) => a.type === "resource")
        .map((a) => a.emailAddress?.address),
    ];
    const matched = candidates.find(
      (email) => email && byEmail.has(email.toLowerCase()),
    );
    if (!matched) continue;
    const room = byEmail.get(matched.toLowerCase())!;
    out.push({
      id: ev.id,
      subject: ev.subject,
      start: ev.start,
      end: ev.end,
      roomEmail: room.emailAddress.toLowerCase(),
      roomName: room.displayName,
    });
  }
  return out;
}
