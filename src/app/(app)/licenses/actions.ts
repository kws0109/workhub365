"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLogs, skuPrices } from "@/db/schema";
import { assertRole } from "@/lib/auth-helpers";
import { getSubscribedSkus } from "@/lib/graph/licenses";
import { defaultSkuInfo } from "@/lib/sku-prices";

const MAX_PRICE_KRW = 10_000_000;

export async function updateSkuPrice(formData: FormData) {
  const session = await assertRole("admin");

  const skuId = String(formData.get("skuId") ?? "");
  const raw = formData.get("monthlyPriceKrw");
  // Number('') === 0 이므로 빈 입력을 코어션 전에 거른다
  if (!skuId || typeof raw !== "string" || raw.trim() === "") {
    throw new Error("INVALID_INPUT");
  }
  const price = Number(raw);
  if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE_KRW) {
    throw new Error("INVALID_PRICE");
  }
  const monthlyPriceKrw = Math.round(price);

  // 클라이언트가 보낸 skuId를 테넌트 SKU 목록과 대조 — 파트넘버·표시명은 서버가 결정
  const sku = (await getSubscribedSkus()).find((s) => s.skuId === skuId);
  if (!sku) throw new Error("UNKNOWN_SKU");

  await db.transaction(async (tx) => {
    // prev는 반드시 트랜잭션 안에서 읽는다 — 밖에서 읽으면 동시 수정 시
    // 감사 로그의 '이전 값'이 거짓이 된다
    const prev = await tx.query.skuPrices.findFirst({
      where: eq(skuPrices.skuId, skuId),
    });
    const displayName =
      prev?.displayName ?? defaultSkuInfo(sku.skuPartNumber)?.name ?? null;

    await tx
      .insert(skuPrices)
      .values({
        skuId,
        skuPartNumber: sku.skuPartNumber,
        displayName,
        monthlyPriceKrw,
      })
      .onConflictDoUpdate({
        target: skuPrices.skuId,
        set: { monthlyPriceKrw },
      });
    await tx.insert(auditLogs).values({
      actorId: session.user.id,
      actorType: "user",
      action: "sku_price.update",
      targetType: "sku",
      targetId: skuId,
      detail: {
        skuPartNumber: sku.skuPartNumber,
        prevMonthlyPriceKrw: prev?.monthlyPriceKrw ?? null,
        monthlyPriceKrw,
      },
      success: true,
    });
  });

  revalidatePath("/licenses");
}
