import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { proposalApprovers, proposals } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";
import { formatDateTimeKst } from "@/lib/format";
import { getTemplate } from "@/lib/proposal";
import { Card } from "@/components/ui";
import { ProposalMasterCard } from "@/components/proposals/master-card";
import { ProposalDetail } from "@/components/proposals/proposal-detail";
import {
  ProposalStatusBadge,
  type ProposalStatus,
} from "@/components/proposals/status-badge";

export const metadata = { title: "내 기안" };

// B12 마스터-디테일 — 좌 360px 문서 카드 리스트 + 우 상세. 선택은 ?sel=<id>(기본: 첫 항목),
// 서버 컴포넌트 유지 — 선택 전환은 Link 이동으로 충분하다
export default async function MyProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ sel?: string }>;
}) {
  const session = await requireSession();
  const { sel } = await searchParams;

  const rows = await db
    .select({
      id: proposals.id,
      templateKey: proposals.templateKey,
      title: proposals.title,
      status: proposals.status,
      currentStep: proposals.currentStep,
      createdAt: proposals.createdAt,
      totalSteps: sql<string>`count(${proposalApprovers.id})`,
    })
    .from(proposals)
    .leftJoin(proposalApprovers, eq(proposalApprovers.proposalId, proposals.id))
    .where(eq(proposals.authorId, session.user.id))
    .groupBy(proposals.id)
    .orderBy(desc(proposals.createdAt))
    .limit(30);

  // 딥링크(sel)가 내 목록 밖 문서여도 디테일이 자체 권한 검사로 렌더링한다 (빈 문자열은 기본값으로)
  const selId = sel || rows[0]?.id;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        {rows.length === 0 && (
          <div className="rounded-[10px] border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-ink-muted">
            작성한 기안이 없습니다 —{" "}
            <Link
              href="/proposals/new"
              className="text-ink-sub underline underline-offset-2"
            >
              기안 작성
            </Link>
            에서 시작하세요
          </div>
        )}
        {rows.map((r) => (
          <ProposalMasterCard
            key={r.id}
            href={`/proposals?sel=${r.id}`}
            selected={r.id === selId}
            title={r.title}
            meta={`${getTemplate(r.templateKey)?.name ?? r.templateKey} · ${formatDateTimeKst(r.createdAt)}${
              r.status === "in_progress"
                ? ` · ${r.currentStep}/${r.totalSteps}차 결재 대기`
                : ""
            }`}
            badge={<ProposalStatusBadge status={r.status as ProposalStatus} />}
          />
        ))}
      </div>
      <div className="min-w-0">
        {selId ? (
          <ProposalDetail
            proposalId={selId}
            viewerId={session.user.id}
            viewerRole={session.user.role}
          />
        ) : (
          <Card className="p-10 text-center text-sm text-ink-muted">
            좌측 목록에서 문서를 선택하세요
          </Card>
        )}
      </div>
    </div>
  );
}
