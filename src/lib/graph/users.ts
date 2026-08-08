import { cachedGraph } from "./cache";
import { graphFetch, graphGetAll } from "./client";

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
  return cachedGraph("graph:directory-users", 60_000, () =>
    graphGetAll<DirectoryUser>(
      "/users?$select=id,displayName,userPrincipalName,accountEnabled,department,jobTitle,assignedLicenses&$top=999",
    ),
  );
}

export async function getGroups(): Promise<DirectoryGroup[]> {
  return cachedGraph("graph:groups", 60_000, () =>
    graphGetAll<DirectoryGroup>("/groups?$select=id,displayName&$top=999"),
  );
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
  await graphFetch(`/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ accountEnabled: enabled }),
  });
}

export async function revokeSignInSessions(userId: string): Promise<void> {
  await graphFetch(`/users/${userId}/revokeSignInSessions`, {
    method: "POST",
  });
}

export async function setUserLicenses(
  userId: string,
  addSkuIds: string[],
  removeSkuIds: string[],
): Promise<void> {
  await graphFetch(`/users/${userId}/assignLicense`, {
    method: "POST",
    body: JSON.stringify({
      addLicenses: addSkuIds.map((skuId) => ({ skuId, disabledPlans: [] })),
      removeLicenses: removeSkuIds,
    }),
  });
}

export async function getUserLicenseSkuIds(userId: string): Promise<string[]> {
  const user = await graphFetch<{ assignedLicenses: { skuId: string }[] }>(
    `/users/${userId}?$select=assignedLicenses`,
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
  }>(`/users/${userId}/memberOf`);
  return items
    .filter((i) => i["@odata.type"] === "#microsoft.graph.group")
    .map((g) => ({
      id: g.id,
      displayName: g.displayName,
      dynamic: g.groupTypes?.includes("DynamicMembership") ?? false,
    }));
}

export async function getUserBasic(
  userId: string,
): Promise<{ id: string; userPrincipalName: string } | null> {
  try {
    return await graphFetch(`/users/${userId}?$select=id,userPrincipalName`);
  } catch {
    return null;
  }
}

export async function addUserToGroup(
  userId: string,
  groupId: string,
): Promise<void> {
  await graphFetch(`/groups/${groupId}/members/$ref`, {
    method: "POST",
    body: JSON.stringify({
      "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${userId}`,
    }),
  });
}

export async function removeUserFromGroup(
  userId: string,
  groupId: string,
): Promise<void> {
  await graphFetch(`/groups/${groupId}/members/${userId}/$ref`, {
    method: "DELETE",
  });
}
