import { requireRole } from "@/lib/auth-helpers";
import { GraphError } from "@/lib/graph/client";
import { getSubscribedSkus } from "@/lib/graph/licenses";
import {
  getDefaultDomain,
  getDirectoryUsers,
  getGroups,
} from "@/lib/graph/users";
import { buildPriceMap } from "@/lib/sku-prices";
import { OnboardWizard } from "@/components/lifecycle/onboard-wizard";
import { OffboardWizard } from "@/components/lifecycle/offboard-wizard";

export const metadata = { title: "온보딩/오프보딩" };

export default async function LifecyclePage() {
  await requireRole("admin");

  try {
    const [skus, groups, users, domain] = await Promise.all([
      getSubscribedSkus(),
      getGroups(),
      getDirectoryUsers(),
      getDefaultDomain(),
    ]);
    const prices = await buildPriceMap(skus);

    const skuOptions = skus.map((s) => ({
      skuId: s.skuId,
      label: prices.get(s.skuId)?.displayName ?? s.skuPartNumber,
      remaining: Math.max(
        0,
        s.prepaidUnits.enabled + s.prepaidUnits.warning - s.consumedUnits,
      ),
    }));

    // 비활성 계정도 포함 — 중간 실패한 오프보딩(차단됨, 회수 미완)을 재개할 경로가 필요
    const offboardTargets = users
      .map((u) => ({
        id: u.id,
        displayName: u.accountEnabled
          ? u.displayName
          : `${u.displayName} (비활성)`,
        userPrincipalName: u.userPrincipalName,
        department: u.department ?? null,
        licenseCount: u.assignedLicenses.length,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));

    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight">온보딩/오프보딩</h1>
        <div className="mt-6 space-y-6">
          <OnboardWizard
            domain={domain}
            skuOptions={skuOptions}
            groupOptions={groups}
          />
          <OffboardWizard users={offboardTargets} />
        </div>
      </div>
    );
  } catch (e) {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">온보딩/오프보딩</h1>
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p className="font-semibold">Graph API 조회에 실패했습니다</p>
          <p className="mt-1">
            {e instanceof GraphError ? `${e.code}: ${e.message}` : "알 수 없는 오류"}
          </p>
        </div>
      </div>
    );
  }
}
