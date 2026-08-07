// 라이선스 낭비 계산 — UI/DB/Graph와 분리된 순수 함수 (단위 테스트 대상).
// 정책(기본값):
//  - 낭비로 집계: 비활성화 계정(disabled), 한 번도 로그인 안 함(never),
//    임계일 이상 미로그인(inactive) 사용자의 할당 라이선스 전액 + SKU별 미할당 좌석
//  - 집계 안 함: active, 그리고 signInActivity를 알 수 없는 unknown(보수적)

import type { LicenseUser, SubscribedSku } from "./graph/licenses";

export type UserStatus = "disabled" | "never" | "inactive" | "active" | "unknown";

export type SkuPriceMap = Map<string, { displayName: string | null; monthlyPriceKrw: number }>;

export type UserWasteRow = {
  userId: string;
  displayName: string;
  userPrincipalName: string;
  status: UserStatus;
  lastSignInAt: Date | null;
  inactiveDays: number | null;
  skuIds: string[];
  monthlyWasteKrw: number;
};

export type SkuSummary = {
  skuId: string;
  skuPartNumber: string;
  displayName: string | null;
  monthlyPriceKrw: number;
  priceMissing: boolean;
  /** Suspended/LockedOut 등 — 과금되지 않으므로 낭비 계산에서 0원 처리 */
  suspended: boolean;
  total: number;
  assigned: number;
  unassigned: number;
  unassignedMonthlyWasteKrw: number;
};

export type Recommendation = {
  kind: "reclaim_disabled" | "review_inactive" | "reduce_unassigned";
  title: string;
  detail: string;
  monthlySavingKrw: number;
};

export type WasteReport = {
  skuSummaries: SkuSummary[];
  userRows: UserWasteRow[];
  totals: {
    unassignedWasteKrw: number;
    assignedWasteKrw: number;
    totalWasteKrw: number;
  };
  recommendations: Recommendation[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** 상호작용/비상호작용 로그인 중 더 최근 시각 */
export function lastSignInOf(user: LicenseUser): Date | null {
  const a = user.signInActivity?.lastSignInDateTime;
  const b = user.signInActivity?.lastNonInteractiveSignInDateTime;
  const times = [a, b]
    .filter((t): t is string => typeof t === "string")
    .map((t) => new Date(t).getTime())
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return null;
  return new Date(Math.max(...times));
}

export function classifyUser(
  user: LicenseUser,
  opts: { inactiveDays: number; signInAvailable: boolean; now: Date },
): { status: UserStatus; lastSignInAt: Date | null; inactiveDays: number | null } {
  if (!user.accountEnabled) {
    return { status: "disabled", lastSignInAt: lastSignInOf(user), inactiveDays: null };
  }
  if (!opts.signInAvailable) {
    return { status: "unknown", lastSignInAt: null, inactiveDays: null };
  }
  const last = lastSignInOf(user);
  if (!last) {
    return { status: "never", lastSignInAt: null, inactiveDays: null };
  }
  const days = Math.floor((opts.now.getTime() - last.getTime()) / DAY_MS);
  if (days >= opts.inactiveDays) {
    return { status: "inactive", lastSignInAt: last, inactiveDays: days };
  }
  return { status: "active", lastSignInAt: last, inactiveDays: days };
}

const WASTED_STATUSES: ReadonlySet<UserStatus> = new Set([
  "disabled",
  "never",
  "inactive",
]);

export function calcLicenseWaste(input: {
  users: LicenseUser[];
  skus: SubscribedSku[];
  prices: SkuPriceMap;
  inactiveDays: number;
  signInAvailable: boolean;
  now: Date;
}): WasteReport {
  const { users, skus, prices, inactiveDays, signInAvailable, now } = input;

  // Suspended/LockedOut/Deleted 구독은 과금되지 않으므로 0원 취급 —
  // 만료된 평가판 좌석을 '낭비'로 과대 보고하지 않기 위함
  const isBillable = (s: SubscribedSku) =>
    s.capabilityStatus === "Enabled" || s.capabilityStatus === "Warning";
  const skuById = new Map(skus.map((s) => [s.skuId, s]));
  const priceOf = (skuId: string) => {
    const sku = skuById.get(skuId);
    if (sku && !isBillable(sku)) return 0;
    return prices.get(skuId)?.monthlyPriceKrw ?? 0;
  };

  const skuSummaries: SkuSummary[] = skus.map((sku) => {
    const price = prices.get(sku.skuId);
    const suspended = !isBillable(sku);
    // warning(유예 기간) 좌석은 여전히 사용·과금 대상이므로 보유에 포함
    const total = sku.prepaidUnits.enabled + sku.prepaidUnits.warning;
    const assigned = sku.consumedUnits;
    const unassigned = Math.max(0, total - assigned);
    const effectivePrice = suspended ? 0 : (price?.monthlyPriceKrw ?? 0);
    return {
      skuId: sku.skuId,
      skuPartNumber: sku.skuPartNumber,
      displayName: price?.displayName ?? null,
      monthlyPriceKrw: price?.monthlyPriceKrw ?? 0,
      priceMissing: !price,
      suspended,
      total,
      assigned,
      unassigned,
      unassignedMonthlyWasteKrw: unassigned * effectivePrice,
    };
  });

  const userRows: UserWasteRow[] = users
    .filter((u) => u.assignedLicenses.length > 0)
    .map((u) => {
      const { status, lastSignInAt, inactiveDays: days } = classifyUser(u, {
        inactiveDays,
        signInAvailable,
        now,
      });
      const skuIds = u.assignedLicenses.map((l) => l.skuId);
      const licenseCostKrw = skuIds.reduce((sum, id) => sum + priceOf(id), 0);
      return {
        userId: u.id,
        displayName: u.displayName,
        userPrincipalName: u.userPrincipalName,
        status,
        lastSignInAt,
        inactiveDays: days,
        skuIds,
        monthlyWasteKrw: WASTED_STATUSES.has(status) ? licenseCostKrw : 0,
      };
    })
    // 낭비 큰 순 → 상태 심각도 순으로 보여준다
    .sort((a, b) => b.monthlyWasteKrw - a.monthlyWasteKrw);

  const unassignedWasteKrw = skuSummaries.reduce(
    (s, k) => s + k.unassignedMonthlyWasteKrw,
    0,
  );
  const assignedWasteKrw = userRows.reduce((s, r) => s + r.monthlyWasteKrw, 0);

  const recommendations: Recommendation[] = [];
  const disabledRows = userRows.filter((r) => r.status === "disabled" && r.monthlyWasteKrw > 0);
  if (disabledRows.length > 0) {
    recommendations.push({
      kind: "reclaim_disabled",
      title: `비활성화된 계정 ${disabledRows.length}명의 라이선스 회수`,
      detail: disabledRows.map((r) => r.displayName).join(", "),
      monthlySavingKrw: disabledRows.reduce((s, r) => s + r.monthlyWasteKrw, 0),
    });
  }
  const inactiveRows = userRows.filter(
    (r) => (r.status === "inactive" || r.status === "never") && r.monthlyWasteKrw > 0,
  );
  if (inactiveRows.length > 0) {
    const neverCount = inactiveRows.filter((r) => r.status === "never").length;
    const inactiveCount = inactiveRows.length - neverCount;
    const parts = [
      inactiveCount > 0 ? `${inactiveDays}일 이상 미로그인 ${inactiveCount}명` : null,
      neverCount > 0 ? `로그인 이력 없음 ${neverCount}명` : null,
    ].filter(Boolean);
    recommendations.push({
      kind: "review_inactive",
      title: `미사용 의심 계정 ${inactiveRows.length}명의 라이선스 회수 검토`,
      detail: `${parts.join(" · ")} — ${inactiveRows.map((r) => r.displayName).join(", ")}`,
      monthlySavingKrw: inactiveRows.reduce((s, r) => s + r.monthlyWasteKrw, 0),
    });
  }
  for (const sku of skuSummaries) {
    if (sku.unassigned > 0 && sku.unassignedMonthlyWasteKrw > 0) {
      recommendations.push({
        kind: "reduce_unassigned",
        title: `${sku.displayName ?? sku.skuPartNumber} 미할당 ${sku.unassigned}석 축소 검토`,
        detail: `보유 ${sku.total}석 중 ${sku.assigned}석만 할당됨`,
        monthlySavingKrw: sku.unassignedMonthlyWasteKrw,
      });
    }
  }
  recommendations.sort((a, b) => b.monthlySavingKrw - a.monthlySavingKrw);

  return {
    skuSummaries,
    userRows,
    totals: {
      unassignedWasteKrw,
      assignedWasteKrw,
      totalWasteKrw: unassignedWasteKrw + assignedWasteKrw,
    },
    recommendations,
  };
}
