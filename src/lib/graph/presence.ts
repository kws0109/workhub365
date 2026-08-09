import "server-only";

import { delegatedGraphFetch } from "./delegated";
import type { Presence } from "@/components/ui";

// 조직도 프레즌스(R8.3) — 위임 Presence.Read.All 필요.
// 스코프 미동의(구세션)·권한 부족이면 호출부가 null로 강등(회색)한다.

const MAX_IDS = 100; // getPresencesByUserId 배치 상한 (R8.3 결정)

type RawPresence = { id: string; availability: string };

/** Graph availability → 표시용 4상태. 알 수 없는 값은 offline(회색) */
export function availabilityToPresence(availability: string): Presence {
  switch (availability) {
    case "Available":
    case "AvailableIdle":
      return "online";
    case "Away":
    case "BeRightBack":
      return "away";
    case "Busy":
    case "BusyIdle":
    case "DoNotDisturb":
      return "busy";
    default:
      return "offline";
  }
}

/** 사용자 id(oid) 목록의 프레즌스 배치 조회 — 상한 초과분은 잘라낸다 */
export async function getPresences(
  token: string,
  userIds: string[],
): Promise<Map<string, Presence>> {
  const ids = userIds.slice(0, MAX_IDS);
  if (ids.length === 0) return new Map();
  const res = await delegatedGraphFetch<{ value: RawPresence[] }>(
    token,
    "/communications/getPresencesByUserId",
    { method: "POST", body: JSON.stringify({ ids }) },
  );
  return new Map(
    res.value.map((p) => [p.id, availabilityToPresence(p.availability)]),
  );
}
