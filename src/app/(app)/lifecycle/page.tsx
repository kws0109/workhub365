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

type PageData = {
  domain: string;
  groups: { id: string; displayName: string }[];
  skuOptions: { skuId: string; label: string; remaining: number }[];
  offboardTargets: {
    id: string;
    displayName: string;
    userPrincipalName: string;
    department: string | null;
    licenseCount: number;
  }[];
};

// 데이터 수집만 try/catch로 감싼다 — JSX를 try 안에서 만들면
// 렌더링 오류가 catch로 잡히는 것처럼 보이지만 실제로는 잡히지 않는다
async function loadPageData(): Promise<
  { ok: true; data: PageData } | { ok: false; error: string }
> {
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

    return { ok: true, data: { domain, groups, skuOptions, offboardTargets } };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof GraphError ? `${e.code}: ${e.message}` : "알 수 없는 오류",
    };
  }
}

export default async function LifecyclePage() {
  await requireRole("admin");
  const result = await loadPageData();

  if (!result.ok) {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">온보딩/오프보딩</h1>
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p className="font-semibold">Graph API 조회에 실패했습니다</p>
          <p className="mt-1">{result.error}</p>
        </div>
      </div>
    );
  }

  const { domain, groups, skuOptions, offboardTargets } = result.data;
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
}
