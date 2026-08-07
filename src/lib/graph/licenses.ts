import { GraphError, graphGetAllPaged } from "./client";

export type SubscribedSku = {
  skuId: string;
  skuPartNumber: string;
  capabilityStatus: string;
  consumedUnits: number;
  prepaidUnits: { enabled: number; suspended: number; warning: number };
};

export type LicenseUser = {
  id: string;
  displayName: string;
  userPrincipalName: string;
  accountEnabled: boolean;
  assignedLicenses: { skuId: string }[];
  signInActivity?: {
    lastSignInDateTime?: string | null;
    lastNonInteractiveSignInDateTime?: string | null;
  } | null;
};

const USER_FIELDS =
  "id,displayName,userPrincipalName,accountEnabled,assignedLicenses";
// 라이선스 보유 사용자만 — 대형 테넌트에서 무의미한 전체 스캔 방지
const LICENSED_FILTER = "$filter=assignedLicenses/$count ne 0&$count=true";
// 999명/페이지 × 50페이지 = 5만 명 상한. 도달 시 truncated 배너로 알린다
const MAX_PAGES = 50;

export async function getSubscribedSkus(): Promise<SubscribedSku[]> {
  const { items } = await graphGetAllPaged<SubscribedSku>("/subscribedSkus");
  return items;
}

/** signInActivity 조회 불가(P1 없음/B2C)를 나타내는 Graph 오류인지 */
function isSignInActivityUnavailable(e: unknown): boolean {
  if (!(e instanceof GraphError)) return false;
  if (e.status === 403) return true;
  return (
    e.status === 400 &&
    /NonPremium|B2C|premium/i.test(`${e.code} ${e.message}`)
  );
}

/**
 * 라이선스 보유 사용자 + 마지막 로그인 수집.
 * signInActivity는 Entra P1 필요 — 해당 오류일 때만 필드 없이 재조회해 강등.
 * 그 외 400(쿼리 버그 등)은 그대로 던져 조용한 오진을 막는다 (R1.2)
 */
export async function getLicenseUsers(): Promise<{
  users: LicenseUser[];
  signInAvailable: boolean;
  truncated: boolean;
}> {
  try {
    const { items, truncated } = await graphGetAllPaged<LicenseUser>(
      `/users?$select=${USER_FIELDS},signInActivity&${LICENSED_FILTER}&$top=999`,
      { maxPages: MAX_PAGES },
    );
    return { users: items, signInAvailable: true, truncated };
  } catch (e) {
    if (isSignInActivityUnavailable(e)) {
      const { items, truncated } = await graphGetAllPaged<LicenseUser>(
        `/users?$select=${USER_FIELDS}&${LICENSED_FILTER}&$top=999`,
        { maxPages: MAX_PAGES },
      );
      return { users: items, signInAvailable: false, truncated };
    }
    throw e;
  }
}
