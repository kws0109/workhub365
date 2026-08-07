import { describe, expect, it } from "vitest";
import type { LicenseUser, SubscribedSku } from "./graph/licenses";
import {
  calcLicenseWaste,
  classifyUser,
  lastSignInOf,
  type SkuPriceMap,
} from "./license-waste";

const NOW = new Date("2026-08-08T00:00:00Z");
const E3 = "sku-e3";
const E5 = "sku-e5";

function user(over: Partial<LicenseUser>): LicenseUser {
  return {
    id: "u1",
    displayName: "홍길동",
    userPrincipalName: "hong@test.com",
    accountEnabled: true,
    assignedLicenses: [{ skuId: E3 }],
    signInActivity: null,
    ...over,
  };
}

function sku(over: Partial<SubscribedSku>): SubscribedSku {
  return {
    skuId: E3,
    skuPartNumber: "SPE_E3",
    capabilityStatus: "Enabled",
    consumedUnits: 1,
    prepaidUnits: { enabled: 1, suspended: 0, warning: 0 },
    ...over,
  };
}

const PRICES: SkuPriceMap = new Map([
  [E3, { displayName: "Microsoft 365 E3", monthlyPriceKrw: 50000 }],
  [E5, { displayName: "Microsoft 365 E5", monthlyPriceKrw: 80000 }],
]);

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("lastSignInOf", () => {
  it("상호작용/비상호작용 중 더 최근 시각을 고른다", () => {
    const u = user({
      signInActivity: {
        lastSignInDateTime: daysAgo(50),
        lastNonInteractiveSignInDateTime: daysAgo(10),
      },
    });
    expect(lastSignInOf(u)).toEqual(new Date(daysAgo(10)));
  });

  it("둘 다 없으면 null", () => {
    expect(lastSignInOf(user({ signInActivity: {} }))).toBeNull();
    expect(lastSignInOf(user({ signInActivity: null }))).toBeNull();
  });
});

describe("classifyUser", () => {
  const opts = { inactiveDays: 30, signInAvailable: true, now: NOW };

  it("비활성화 계정은 로그인 이력과 무관하게 disabled", () => {
    const u = user({
      accountEnabled: false,
      signInActivity: { lastSignInDateTime: daysAgo(1) },
    });
    expect(classifyUser(u, opts).status).toBe("disabled");
  });

  it("signInActivity 조회 불가면 unknown (낭비 미집계의 근거)", () => {
    const u = user({ signInActivity: { lastSignInDateTime: daysAgo(100) } });
    expect(
      classifyUser(u, { ...opts, signInAvailable: false }).status,
    ).toBe("unknown");
  });

  it("로그인 이력이 아예 없으면 never", () => {
    expect(classifyUser(user({}), opts).status).toBe("never");
  });

  it("경계: 정확히 임계일이면 inactive, 임계일-1이면 active", () => {
    const at30 = user({ signInActivity: { lastSignInDateTime: daysAgo(30) } });
    const at29 = user({ signInActivity: { lastSignInDateTime: daysAgo(29) } });
    expect(classifyUser(at30, opts).status).toBe("inactive");
    expect(classifyUser(at29, opts).status).toBe("active");
  });
});

describe("calcLicenseWaste", () => {
  it("미할당 좌석 낭비 = (보유-할당) × 단가", () => {
    const report = calcLicenseWaste({
      users: [],
      skus: [sku({ consumedUnits: 1, prepaidUnits: { enabled: 25, suspended: 0, warning: 0 } })],
      prices: PRICES,
      inactiveDays: 30,
      signInAvailable: true,
      now: NOW,
    });
    expect(report.skuSummaries[0].unassigned).toBe(24);
    expect(report.skuSummaries[0].unassignedMonthlyWasteKrw).toBe(24 * 50000);
    expect(report.totals.unassignedWasteKrw).toBe(24 * 50000);
  });

  it("disabled/never/inactive 사용자의 라이선스만 할당 낭비로 집계", () => {
    const report = calcLicenseWaste({
      users: [
        user({ id: "a", accountEnabled: false }), // disabled → 낭비
        user({ id: "b" }), // never → 낭비
        user({ id: "c", signInActivity: { lastSignInDateTime: daysAgo(90) } }), // inactive → 낭비
        user({ id: "d", signInActivity: { lastSignInDateTime: daysAgo(3) } }), // active → 0
      ],
      skus: [sku({})],
      prices: PRICES,
      inactiveDays: 30,
      signInAvailable: true,
      now: NOW,
    });
    const byId = Object.fromEntries(report.userRows.map((r) => [r.userId, r]));
    expect(byId.a.monthlyWasteKrw).toBe(50000);
    expect(byId.b.monthlyWasteKrw).toBe(50000);
    expect(byId.c.monthlyWasteKrw).toBe(50000);
    expect(byId.d.monthlyWasteKrw).toBe(0);
    expect(report.totals.assignedWasteKrw).toBe(150000);
  });

  it("signInAvailable=false면 활성 여부를 모르므로 할당 낭비 0 (보수적)", () => {
    const report = calcLicenseWaste({
      users: [user({ signInActivity: { lastSignInDateTime: daysAgo(365) } })],
      skus: [sku({})],
      prices: PRICES,
      inactiveDays: 30,
      signInAvailable: false,
      now: NOW,
    });
    expect(report.userRows[0].status).toBe("unknown");
    expect(report.totals.assignedWasteKrw).toBe(0);
  });

  it("복수 라이선스 사용자의 낭비는 단가 합", () => {
    const report = calcLicenseWaste({
      users: [
        user({
          accountEnabled: false,
          assignedLicenses: [{ skuId: E3 }, { skuId: E5 }],
        }),
      ],
      skus: [sku({})],
      prices: PRICES,
      inactiveDays: 30,
      signInAvailable: true,
      now: NOW,
    });
    expect(report.userRows[0].monthlyWasteKrw).toBe(130000);
  });

  it("단가 누락 SKU는 0원 + priceMissing 플래그", () => {
    const report = calcLicenseWaste({
      users: [],
      skus: [
        sku({
          skuId: "sku-unknown",
          skuPartNumber: "MYSTERY_SKU",
          consumedUnits: 0,
          prepaidUnits: { enabled: 5, suspended: 0, warning: 0 },
        }),
      ],
      prices: PRICES,
      inactiveDays: 30,
      signInAvailable: true,
      now: NOW,
    });
    expect(report.skuSummaries[0].priceMissing).toBe(true);
    expect(report.skuSummaries[0].unassignedMonthlyWasteKrw).toBe(0);
  });

  it("라이선스 없는 사용자는 행에서 제외", () => {
    const report = calcLicenseWaste({
      users: [user({ assignedLicenses: [] })],
      skus: [sku({})],
      prices: PRICES,
      inactiveDays: 30,
      signInAvailable: true,
      now: NOW,
    });
    expect(report.userRows).toHaveLength(0);
  });

  it("초과 할당(consumed > enabled) 시 미할당은 0으로 클램프", () => {
    const report = calcLicenseWaste({
      users: [],
      skus: [
        sku({ consumedUnits: 13, prepaidUnits: { enabled: 10, suspended: 0, warning: 0 } }),
      ],
      prices: PRICES,
      inactiveDays: 30,
      signInAvailable: true,
      now: NOW,
    });
    expect(report.skuSummaries[0].unassigned).toBe(0);
    expect(report.skuSummaries[0].unassignedMonthlyWasteKrw).toBe(0);
  });

  it("Suspended 구독은 과금되지 않으므로 낭비 0원 처리", () => {
    const report = calcLicenseWaste({
      users: [user({ accountEnabled: false })], // disabled인데 라이선스가 Suspended SKU
      skus: [
        sku({
          capabilityStatus: "Suspended",
          consumedUnits: 1,
          prepaidUnits: { enabled: 10, suspended: 10, warning: 0 },
        }),
      ],
      prices: PRICES,
      inactiveDays: 30,
      signInAvailable: true,
      now: NOW,
    });
    expect(report.skuSummaries[0].suspended).toBe(true);
    expect(report.skuSummaries[0].unassignedMonthlyWasteKrw).toBe(0);
    expect(report.userRows[0].monthlyWasteKrw).toBe(0);
    expect(report.totals.totalWasteKrw).toBe(0);
  });

  it("warning(유예) 좌석은 보유 좌석에 포함", () => {
    const report = calcLicenseWaste({
      users: [],
      skus: [
        sku({
          capabilityStatus: "Warning",
          consumedUnits: 5,
          prepaidUnits: { enabled: 0, suspended: 0, warning: 10 },
        }),
      ],
      prices: PRICES,
      inactiveDays: 30,
      signInAvailable: true,
      now: NOW,
    });
    expect(report.skuSummaries[0].total).toBe(10);
    expect(report.skuSummaries[0].unassigned).toBe(5);
    expect(report.skuSummaries[0].unassignedMonthlyWasteKrw).toBe(5 * 50000);
  });

  it("추천은 절감액 큰 순으로 정렬", () => {
    const report = calcLicenseWaste({
      users: [user({ id: "a", accountEnabled: false })], // 회수 5만
      skus: [
        sku({ consumedUnits: 1, prepaidUnits: { enabled: 25, suspended: 0, warning: 0 } }), // 미할당 120만
      ],
      prices: PRICES,
      inactiveDays: 30,
      signInAvailable: true,
      now: NOW,
    });
    expect(report.recommendations[0].kind).toBe("reduce_unassigned");
    expect(report.recommendations[1].kind).toBe("reclaim_disabled");
  });
});
