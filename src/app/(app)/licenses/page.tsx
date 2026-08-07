import Link from "next/link";
import { requireRole } from "@/lib/auth-helpers";
import { GraphError } from "@/lib/graph/client";
import { getLicenseUsers, getSubscribedSkus } from "@/lib/graph/licenses";
import {
  calcLicenseWaste,
  type UserStatus,
  type WasteReport,
} from "@/lib/license-waste";
import { buildPriceMap } from "@/lib/sku-prices";
import { formatDateKst, formatKrw } from "@/lib/format";
import { updateSkuPrice } from "./actions";

export const metadata = { title: "라이선스" };

const THRESHOLDS = [30, 60, 90] as const;

export default async function LicensesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireRole("admin");
  const { days } = await searchParams;
  const inactiveDays = THRESHOLDS.includes(Number(days) as 30 | 60 | 90)
    ? Number(days)
    : 30;

  let report: WasteReport;
  let signInAvailable: boolean;
  let truncated: boolean;
  try {
    const [skus, usersResult] = await Promise.all([
      getSubscribedSkus(),
      getLicenseUsers(),
    ]);
    const prices = await buildPriceMap(skus);
    signInAvailable = usersResult.signInAvailable;
    truncated = usersResult.truncated;
    report = calcLicenseWaste({
      users: usersResult.users,
      skus,
      prices,
      inactiveDays,
      signInAvailable,
      now: new Date(),
    });
  } catch (e) {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">라이선스</h1>
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p className="font-semibold">Graph API 조회에 실패했습니다</p>
          <p className="mt-1">
            {e instanceof GraphError
              ? `${e.code}: ${e.message}`
              : "알 수 없는 오류"}
          </p>
        </div>
      </div>
    );
  }

  const { skuSummaries, userRows, totals, recommendations } = report;
  const totalSeats = skuSummaries.reduce((s, k) => s + k.total, 0);
  const assignedSeats = skuSummaries.reduce((s, k) => s + k.assigned, 0);
  // SKU 테이블과 같은 클램프값의 합 — total-assigned 산식은 초과 할당 시 음수가 된다
  const unassignedSeats = skuSummaries.reduce((s, k) => s + k.unassigned, 0);

  return (
    <div className="max-w-5xl">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-bold tracking-tight">라이선스</h1>
        <div className="flex items-center gap-1 text-sm">
          <span className="mr-1 text-zinc-500">비활성 기준</span>
          {THRESHOLDS.map((t) => (
            <Link
              key={t}
              href={`/licenses?days=${t}`}
              className={`rounded-lg px-3 py-1 font-medium ${
                t === inactiveDays
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {t}일
            </Link>
          ))}
        </div>
      </div>

      {!signInAvailable && (
        <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          마지막 로그인(signInActivity)을 조회할 수 없어 비활성 판정을 건너뜁니다
          — Entra ID P1 라이선스와 AuditLog.Read.All 권한이 필요합니다.
        </div>
      )}
      {truncated && (
        <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          사용자가 많아 일부만 수집했습니다 — 아래 수치는 부분 데이터 기준입니다.
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="보유 좌석" value={`${totalSeats}석`} />
        <StatCard label="할당" value={`${assignedSeats}석`} />
        <StatCard label="미할당" value={`${unassignedSeats}석`} />
        <StatCard
          label="월 낭비 추정"
          value={formatKrw(totals.totalWasteKrw)}
          accent
        />
      </div>

      {recommendations.length > 0 && (
        <section className="mt-8">
          <h2 className="font-semibold">절감 추천</h2>
          <ul className="mt-3 space-y-2">
            {recommendations.map((r, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{r.detail}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-emerald-600">
                  월 {formatKrw(r.monthlySavingKrw)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-semibold">SKU 현황 · 단가</h2>
        <p className="mt-1 text-xs text-zinc-400">
          단가는 참고용 기본값입니다. 계약 단가로 수정하면 낭비 금액에 즉시
          반영됩니다.
        </p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="px-4 py-2 font-medium">SKU</th>
                <th className="px-4 py-2 text-right font-medium">보유</th>
                <th className="px-4 py-2 text-right font-medium">할당</th>
                <th className="px-4 py-2 text-right font-medium">미할당</th>
                <th className="px-4 py-2 text-right font-medium">미할당 낭비/월</th>
                <th className="px-4 py-2 text-right font-medium">단가/월</th>
              </tr>
            </thead>
            <tbody>
              {skuSummaries.map((sku) => (
                <tr key={sku.skuId} className="border-b border-zinc-100 last:border-0">
                  <td className="px-4 py-2">
                    <p className="font-medium">
                      {sku.displayName ?? sku.skuPartNumber}
                      {sku.suspended && (
                        <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">
                          구독 중단됨 · 0원 처리
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-400">{sku.skuPartNumber}</p>
                  </td>
                  <td className="px-4 py-2 text-right">{sku.total}</td>
                  <td className="px-4 py-2 text-right">{sku.assigned}</td>
                  <td className="px-4 py-2 text-right">{sku.unassigned}</td>
                  <td className="px-4 py-2 text-right text-red-600">
                    {formatKrw(sku.unassignedMonthlyWasteKrw)}
                  </td>
                  <td className="px-4 py-2">
                    <form action={updateSkuPrice} className="flex items-center justify-end gap-2">
                      <input type="hidden" name="skuId" value={sku.skuId} />
                      <input
                        type="number"
                        name="monthlyPriceKrw"
                        defaultValue={sku.monthlyPriceKrw}
                        required
                        min={0}
                        max={10_000_000}
                        step={100}
                        className="w-24 rounded-lg border border-zinc-200 px-2 py-1 text-right"
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-zinc-100 px-2 py-1 text-xs font-medium hover:bg-zinc-200"
                      >
                        저장
                      </button>
                    </form>
                    {sku.priceMissing && (
                      <p className="mt-1 text-right text-xs text-amber-600">
                        단가 미설정
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">사용자별 현황</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="px-4 py-2 font-medium">사용자</th>
                <th className="px-4 py-2 font-medium">상태</th>
                <th className="px-4 py-2 font-medium">마지막 로그인</th>
                <th className="px-4 py-2 text-right font-medium">라이선스</th>
                <th className="px-4 py-2 text-right font-medium">낭비/월</th>
              </tr>
            </thead>
            <tbody>
              {userRows.map((row) => (
                <tr key={row.userId} className="border-b border-zinc-100 last:border-0">
                  <td className="px-4 py-2">
                    <p className="font-medium">{row.displayName}</p>
                    <p className="text-xs text-zinc-400">{row.userPrincipalName}</p>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2 text-zinc-600">
                    {formatDateKst(row.lastSignInAt)}
                    {row.inactiveDays !== null && (
                      <span className="ml-1 text-xs text-zinc-400">
                        ({row.inactiveDays}일 전)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">{row.skuIds.length}개</td>
                  <td className="px-4 py-2 text-right">
                    {row.monthlyWasteKrw > 0 ? (
                      <span className="font-medium text-red-600">
                        {formatKrw(row.monthlyWasteKrw)}
                      </span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {userRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-400">
                    라이선스가 할당된 사용자가 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p
        className={`mt-1 text-xl font-bold tracking-tight ${accent ? "text-red-600" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

const STATUS_STYLE: Record<UserStatus, { label: string; cls: string }> = {
  disabled: { label: "비활성화됨", cls: "bg-red-50 text-red-600" },
  never: { label: "로그인 이력 없음", cls: "bg-orange-50 text-orange-600" },
  inactive: { label: "비활성", cls: "bg-amber-50 text-amber-700" },
  active: { label: "활성", cls: "bg-emerald-50 text-emerald-600" },
  unknown: { label: "알 수 없음", cls: "bg-zinc-100 text-zinc-500" },
};

function StatusBadge({ status }: { status: UserStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}
