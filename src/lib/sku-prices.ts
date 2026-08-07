import { db } from "@/db";
import { skuPrices } from "@/db/schema";
import type { SubscribedSku } from "./graph/licenses";
import type { SkuPriceMap } from "./license-waste";

// 참고용 기본 단가(원/월, 대략치) — skuPartNumber 기준. 단가표 화면에서 수정 가능
const DEFAULT_PRICES_KRW: Record<string, { name: string; priceKrw: number }> = {
  SPE_E3: { name: "Microsoft 365 E3", priceKrw: 49500 },
  SPE_E5: { name: "Microsoft 365 E5", priceKrw: 81400 },
  SPE_F1: { name: "Microsoft 365 F3", priceKrw: 11000 },
  ENTERPRISEPACK: { name: "Office 365 E3", priceKrw: 31900 },
  ENTERPRISEPREMIUM: { name: "Office 365 E5", priceKrw: 53900 },
  O365_BUSINESS_ESSENTIALS: { name: "Business Basic", priceKrw: 8250 },
  O365_BUSINESS_PREMIUM: { name: "Business Standard", priceKrw: 17200 },
  SPB: { name: "Business Premium", priceKrw: 30250 },
  EXCHANGESTANDARD: { name: "Exchange Online Plan 1", priceKrw: 5500 },
  POWER_BI_PRO: { name: "Power BI Pro", priceKrw: 19300 },
  FLOW_FREE: { name: "Power Automate Free", priceKrw: 0 },
};

export function defaultSkuInfo(
  skuPartNumber: string,
): { name: string; priceKrw: number } | null {
  return DEFAULT_PRICES_KRW[skuPartNumber] ?? null;
}

/**
 * SKU 단가 맵 구성: DB 단가표가 1순위, 없으면 기본 단가로 폴백.
 * 어느 쪽에도 없으면 맵에 넣지 않는다 → calcLicenseWaste가 priceMissing 처리
 */
export async function buildPriceMap(skus: SubscribedSku[]): Promise<SkuPriceMap> {
  const rows = await db.select().from(skuPrices);
  const byId = new Map(rows.map((r) => [r.skuId, r]));

  const map: SkuPriceMap = new Map();
  for (const sku of skus) {
    const row = byId.get(sku.skuId);
    if (row) {
      map.set(sku.skuId, {
        displayName: row.displayName,
        monthlyPriceKrw: row.monthlyPriceKrw,
      });
      continue;
    }
    const fallback = DEFAULT_PRICES_KRW[sku.skuPartNumber];
    if (fallback) {
      map.set(sku.skuId, {
        displayName: fallback.name,
        monthlyPriceKrw: fallback.priceKrw,
      });
    }
  }
  return map;
}
