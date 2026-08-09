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
import {
  Badge,
  type BadgeTone,
  PageHeader,
  SourceChip,
  StatTile,
  TabLink,
} from "@/components/ui";
import { updateSkuPrice } from "./actions";

export const metadata = { title: "라이선스" };

// 비활성 기준 세그먼트(30/60/90일) — searchParams 화이트리스트
const THRESHOLDS = [30, 60, 90] as const;

const STATUS_BADGE: Record<UserStatus, { label: string; tone: BadgeTone }> = {
  disabled: { label: "비활성화됨", tone: "danger" },
  never: { label: "로그인 이력 없음", tone: "orange" },
  inactive: { label: "비활성", tone: "warn" },
  active: { label: "활성", tone: "success" },
  unknown: { label: "알 수 없음", tone: "neutral" },
};

export default async function LicensesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireRole("admin");
  const { days } = await searchParams;
  const inactiveDays =
    THRESHOLDS.find((t) => t === Number(days)) ?? THRESHOLDS[0];

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
      <div className="max-w-[1140px]">
        <PageHeader
          title="라이선스"
          subtitle={<SourceChip brand="graph">Graph API · subscribedSkus</SourceChip>}
        />
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
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

  // B13: 직접 실행이 아니라 어시스턴트 프리필 딥링크 — 실제 회수는 기존 reclaim
  // 도구의 승인 카드 게이트(아키텍처 규칙 3)를 그대로 통과한다
  const reclaimPrompt = `${inactiveDays}일 이상 비활성 계정의 미사용 라이선스를 회수해줘`;
  const assistantHref = `/assistant?prompt=${encodeURIComponent(reclaimPrompt)}`;

  return (
    <div className="max-w-[1140px]">
      <PageHeader
        title="라이선스"
        subtitle={<SourceChip brand="graph">Graph API · subscribedSkus</SourceChip>}
        actions={
          <>
            <span className="mr-1 text-[13px] text-ink-secondary">
              비활성 기준
            </span>
            <nav className="flex gap-1">
              {THRESHOLDS.map((t) => (
                <TabLink
                  key={t}
                  href={`/licenses?days=${t}`}
                  active={t === inactiveDays}
                >
                  {t}일
                </TabLink>
              ))}
            </nav>
          </>
        }
      />

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

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile compact label="보유 좌석" value={`${totalSeats}석`} />
        <StatTile compact label="할당" value={`${assignedSeats}석`} />
        <StatTile compact label="미할당" value={`${unassignedSeats}석`} />
        <StatTile
          compact
          label="월 낭비 추정"
          value={formatKrw(totals.totalWasteKrw)}
          valueClassName="text-red-600"
        />
      </div>

      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">절감 추천</h2>
          <Link
            href={assistantHref}
            className="rounded-lg bg-ink px-3.5 py-[7px] text-xs font-medium text-white transition hover:bg-ink-body"
          >
            AI 어시스턴트로 일괄 회수
          </Link>
        </div>
        <div className="mt-2.5 flex flex-col gap-2">
          {recommendations.map((r, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="mt-0.5 text-xs text-ink-secondary">{r.detail}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-emerald-600">
                월 {formatKrw(r.monthlySavingKrw)} 절감
              </span>
            </div>
          ))}
          {recommendations.length === 0 && (
            <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
              현재 절감 추천이 없습니다 — 모든 라이선스가 활용되고 있습니다
            </div>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-[15px] font-semibold">SKU 현황 · 단가</h2>
        <p className="mt-1 text-xs text-ink-muted">
          단가는 참고용 기본값입니다 — 계약 단가로 수정하면 낭비 금액에 즉시
          반영됩니다
        </p>
        <div className="mt-2.5 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-medium text-ink-muted">
                <th className="px-4 py-2 font-medium">SKU</th>
                <th className="px-4 py-2 text-right font-medium">보유</th>
                <th className="px-4 py-2 text-right font-medium">할당</th>
                <th className="px-4 py-2 text-right font-medium">미할당</th>
                <th className="px-4 py-2 text-right font-medium">
                  미할당 낭비/월
                </th>
                <th className="px-4 py-2 text-right font-medium">단가/월</th>
              </tr>
            </thead>
            <tbody>
              {skuSummaries.map((sku) => (
                <tr key={sku.skuId} className="border-t border-fill">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">
                      {sku.displayName ?? sku.skuPartNumber}
                      {sku.suspended && (
                        <Badge tone="neutral" className="ml-2">
                          구독 중단됨 · 0원 처리
                        </Badge>
                      )}
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      {sku.skuPartNumber}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-right">{sku.total}</td>
                  <td className="px-4 py-2.5 text-right">{sku.assigned}</td>
                  <td className="px-4 py-2.5 text-right">{sku.unassigned}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-red-600">
                    {formatKrw(sku.unassignedMonthlyWasteKrw)}
                  </td>
                  <td className="px-4 py-2.5">
                    {/* 단가 인라인 편집 — Server Action(updateSkuPrice)이 감사 로그까지 기록 */}
                    <form
                      action={updateSkuPrice}
                      className="flex items-center justify-end gap-1.5"
                    >
                      <input type="hidden" name="skuId" value={sku.skuId} />
                      <input
                        type="number"
                        name="monthlyPriceKrw"
                        defaultValue={sku.monthlyPriceKrw}
                        required
                        min={0}
                        max={10_000_000}
                        step={100}
                        className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-right text-xs outline-none focus:border-line-strong"
                      />
                      <button
                        type="submit"
                        className="rounded-md bg-fill px-2 py-1 text-[11px] font-medium text-ink-sub transition hover:bg-line"
                      >
                        저장
                      </button>
                    </form>
                    {sku.priceMissing && (
                      <p className="mt-1 text-right text-[11px] text-amber-600">
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

      <section className="mt-6">
        <h2 className="text-[15px] font-semibold">사용자별 현황</h2>
        <div className="mt-2.5 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-medium text-ink-muted">
                <th className="px-4 py-2 font-medium">사용자</th>
                <th className="px-4 py-2 font-medium">상태</th>
                <th className="px-4 py-2 font-medium">마지막 로그인</th>
                <th className="px-4 py-2 text-right font-medium">라이선스</th>
                <th className="px-4 py-2 text-right font-medium">낭비/월</th>
              </tr>
            </thead>
            <tbody>
              {userRows.map((row) => (
                <tr key={row.userId} className="border-t border-fill">
                  <td className="px-4 py-2">
                    <p className="font-medium">{row.displayName}</p>
                    <p className="text-[11px] text-ink-muted">
                      {row.userPrincipalName}
                    </p>
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={STATUS_BADGE[row.status].tone}>
                      {STATUS_BADGE[row.status].label}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-sub">
                    {formatDateKst(row.lastSignInAt)}
                    {row.inactiveDays !== null && (
                      <span className="ml-1 text-[11px] text-ink-muted">
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
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {userRows.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-ink-muted"
                  >
                    라이선스가 할당된 사용자가 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2.5 text-xs text-ink-muted">
          비활성 판정은 signInActivity(마지막 로그인) 기준 · Entra ID P1 미보유
          테넌트는 &ldquo;알 수 없음&rdquo;으로 강등 표시됩니다
        </p>
      </section>
    </div>
  );
}
