import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getUserBasic } from "@/lib/graph/users";

// 관리자가 자기 계정을 잠그는 사고를 막는 가드. 오프보딩 마법사와 AI 어시스턴트
// 두 경로가 이 한 곳을 공유한다 — 가드를 호출 지점마다 두면 새 경로가 생길 때마다
// 빠뜨린다(실제로 어시스턴트의 block_user·revoke_user_sessions에는 없었다).
//
// 문자열 비교만으로는 부족하다: Graph의 /users/{id|userPrincipalName}는 UPN도 받으므로
// 세션의 entraId(GUID)와 raw 입력을 비교하면 본인 UPN을 보낸 요청이 가드를 통과한다.
// 따라서 대상을 먼저 Graph로 정규화(getUserBasic)해 GUID를 얻은 뒤 비교하고,
// 호출부에는 정규화된 GUID만 돌려준다 — 이후 파이프라인이 raw 입력을 다시 쓰지 않도록.

/** 위반·대상 부재를 호출부가 사용자 메시지로 그대로 쓸 수 있게 Error로 던진다 */
export class SelfTargetError extends Error {}

/**
 * 관리 액션 대상을 검증·정규화한다.
 *
 * @param actorUserId 요청자의 DB users.id. 세션이 없는 경로(stdio MCP)는 undefined —
 *   비교할 "자기 자신"이 없으므로 정규화만 수행한다
 * @param rawTargetId 사용자가 보낸 대상 식별자 (GUID 또는 UPN)
 * @param actionLabel 오류 문구에 넣을 액션 이름 (예: "오프보딩", "계정 차단")
 * @returns 정규화된 Entra 객체 ID(GUID)
 * @throws {SelfTargetError} 대상이 존재하지 않거나 요청자 본인일 때
 */
export async function assertNotSelfTarget(
  actorUserId: string | undefined,
  rawTargetId: string,
  actionLabel: string,
): Promise<string> {
  // 온보딩 재개 대상 검증과 같은 fail-closed 규약 — 확인되지 않으면 진행하지 않는다
  const target = await getUserBasic(rawTargetId);
  if (!target) {
    throw new SelfTargetError("대상 사용자를 찾을 수 없습니다");
  }
  if (!actorUserId) return target.id;

  const me = await db.query.users.findFirst({
    where: eq(users.id, actorUserId),
    columns: { entraId: true },
  });
  // GUID는 대소문자를 구분하지 않는다
  if (me?.entraId && me.entraId.toLowerCase() === target.id.toLowerCase()) {
    throw new SelfTargetError(`자기 자신은 ${actionLabel} 대상이 될 수 없습니다`);
  }
  return target.id;
}
