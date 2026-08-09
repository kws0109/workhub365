import { cachedGraph } from "./cache";
import { GraphError, graphFetch, graphGetAll, graphGetAllPaged } from "./client";

// 999명/페이지 × 50페이지 — licenses.ts와 동일한 대형 테넌트 방어선
const MAX_PAGES = 50;

// 경로 세그먼트에 들어가는 식별자는 encodeURIComponent로 감싼다.
// /users/{id|userPrincipalName}는 UPN도 받으므로 값이 GUID라는 보장이 없고,
// UPN에는 #·+ 등 경로에서 의미를 갖는 문자가 들어갈 수 있다
// (위임 호출 쪽 mail.ts·drive.ts·rooms.ts는 이미 같은 방어를 하고 있다).

export type DirectoryUser = {
  id: string;
  displayName: string;
  userPrincipalName: string;
  accountEnabled: boolean;
  department?: string | null;
  jobTitle?: string | null;
  assignedLicenses: { skuId: string }[];
};

export type DirectoryGroup = {
  id: string;
  displayName: string;
};

export async function getDirectoryUsers(): Promise<DirectoryUser[]> {
  return cachedGraph("graph:directory-users", 60_000, async () => {
    const { items } = await graphGetAllPaged<DirectoryUser>(
      "/users?$select=id,displayName,userPrincipalName,accountEnabled,department,jobTitle,assignedLicenses&$top=999",
      { maxPages: MAX_PAGES },
    );
    return items;
  });
}

export async function getGroups(): Promise<DirectoryGroup[]> {
  return cachedGraph("graph:groups", 60_000, async () => {
    const { items } = await graphGetAllPaged<DirectoryGroup>(
      "/groups?$select=id,displayName&$top=999",
      { maxPages: MAX_PAGES },
    );
    return items;
  });
}

export async function getDefaultDomain(): Promise<string> {
  // 도메인은 사실상 불변 — 길게 캐시
  return cachedGraph("graph:default-domain", 60 * 60_000, async () => {
    const domains = await graphGetAll<{ id: string; isDefault: boolean }>(
      "/domains",
    );
    const def = domains.find((d) => d.isDefault);
    if (!def) throw new Error("기본 도메인을 찾을 수 없습니다");
    return def.id;
  });
}

export async function createUser(input: {
  displayName: string;
  mailNickname: string;
  userPrincipalName: string;
  department: string;
  jobTitle: string;
  tempPassword: string;
}): Promise<{ id: string; userPrincipalName: string }> {
  return graphFetch("/users", {
    method: "POST",
    body: JSON.stringify({
      accountEnabled: true,
      displayName: input.displayName,
      mailNickname: input.mailNickname,
      userPrincipalName: input.userPrincipalName,
      department: input.department,
      jobTitle: input.jobTitle,
      usageLocation: "KR", // assignLicense 필수 조건
      passwordProfile: {
        password: input.tempPassword,
        forceChangePasswordNextSignIn: true,
      },
    }),
  });
}

export async function setAccountEnabled(
  userId: string,
  enabled: boolean,
): Promise<void> {
  await graphFetch(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ accountEnabled: enabled }),
  });
}

export async function revokeSignInSessions(userId: string): Promise<void> {
  await graphFetch(`/users/${encodeURIComponent(userId)}/revokeSignInSessions`, {
    method: "POST",
  });
}

export async function setUserLicenses(
  userId: string,
  addSkuIds: string[],
  removeSkuIds: string[],
): Promise<void> {
  await graphFetch(`/users/${encodeURIComponent(userId)}/assignLicense`, {
    method: "POST",
    body: JSON.stringify({
      addLicenses: addSkuIds.map((skuId) => ({ skuId, disabledPlans: [] })),
      removeLicenses: removeSkuIds,
    }),
  });
}

export async function getUserLicenseSkuIds(userId: string): Promise<string[]> {
  const user = await graphFetch<{ assignedLicenses: { skuId: string }[] }>(
    `/users/${encodeURIComponent(userId)}?$select=assignedLicenses`,
  );
  return user.assignedLicenses.map((l) => l.skuId);
}

export async function getUserGroupIds(
  userId: string,
): Promise<{ id: string; displayName: string; dynamic: boolean }[]> {
  // memberOf에는 디렉터리 역할 등도 섞여 오므로 group만 필터.
  // groupTypes로 동적 멤버십 그룹을 표시해 호출부가 멤버 제거를 건너뛸 수 있게 한다
  const items = await graphGetAll<{
    "@odata.type": string;
    id: string;
    displayName: string;
    groupTypes?: string[];
  }>(`/users/${encodeURIComponent(userId)}/memberOf`);
  return items
    .filter((i) => i["@odata.type"] === "#microsoft.graph.group")
    .map((g) => ({
      id: g.id,
      displayName: g.displayName,
      dynamic: g.groupTypes?.includes("DynamicMembership") ?? false,
    }));
}

export type UserBasic = {
  id: string;
  displayName: string;
  userPrincipalName: string;
};

/**
 * "대상이 존재하지 않음"으로 확정할 수 있는 Graph 오류인지.
 * 404는 물론, GUID/UPN 형식이 아닌 id로 인한 400도 재시도해봐야 달라지지 않으므로
 * 부재로 본다. 403·429·5xx·타임아웃은 부재의 증거가 아니므로 여기서 제외한다.
 */
function isTargetNotFound(e: unknown): boolean {
  if (!(e instanceof GraphError)) return false;
  if (e.status === 404) return true;
  return (
    e.status === 400 &&
    /Request_BadRequest|Invalid object identifier|invalid/i.test(
      `${e.code} ${e.message}`,
    )
  );
}

/**
 * 승인 카드용 사용자 이름 해석.
 * 부재는 null, 그 밖의 Graph 오류(권한·스로틀·타임아웃)는 그대로 던진다 —
 * 호출부가 "대상 없음"(승인 요청 생성 중단)과 "일시 장애"(이름 없이 진행)를
 * 구분해야 하기 때문. 오류를 전부 null로 뭉개는 관대 버전은 아래 getUserBasic이다.
 */
export async function lookupUserBasic(
  userId: string,
): Promise<UserBasic | null> {
  try {
    return await graphFetch<UserBasic>(
      `/users/${encodeURIComponent(userId)}?$select=id,displayName,userPrincipalName`,
    );
  } catch (e) {
    if (isTargetNotFound(e)) return null;
    throw e;
  }
}

/**
 * 오류를 전부 null로 강등하는 관대 버전 — 온보딩 재개 대상 검증처럼
 * "확인되지 않으면 진행하지 않는다"(fail-closed) 호출부용.
 */
export async function getUserBasic(userId: string): Promise<UserBasic | null> {
  try {
    return await lookupUserBasic(userId);
  } catch {
    return null;
  }
}

/**
 * 승인 카드용 그룹 이름 해석. 부재는 null, 일시 장애는 던진다(lookupUserBasic과 동일 규약).
 * 캐시된 목록(list_groups와 공유)에서 먼저 찾고 없을 때만 단건 조회로 확인한다 —
 * 목록은 60초 캐시·페이지 상한이 있어 "목록에 없음"만으로 부재를 단정할 수 없다.
 */
export async function lookupGroupBasic(
  groupId: string,
): Promise<DirectoryGroup | null> {
  const cached = (await getGroups()).find((g) => g.id === groupId);
  if (cached) return cached;
  try {
    return await graphFetch<DirectoryGroup>(
      `/groups/${encodeURIComponent(groupId)}?$select=id,displayName`,
    );
  } catch (e) {
    if (isTargetNotFound(e)) return null;
    throw e;
  }
}

export async function addUserToGroup(
  userId: string,
  groupId: string,
): Promise<void> {
  await graphFetch(`/groups/${encodeURIComponent(groupId)}/members/$ref`, {
    method: "POST",
    body: JSON.stringify({
      "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${encodeURIComponent(userId)}`,
    }),
  });
}

export async function removeUserFromGroup(
  userId: string,
  groupId: string,
): Promise<void> {
  await graphFetch(
    `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/$ref`,
    { method: "DELETE" },
  );
}
