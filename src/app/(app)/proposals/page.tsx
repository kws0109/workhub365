import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { proposalApprovers, proposals } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";
import { formatDateTimeKst } from "@/lib/format";
import { getTemplate } from "@/lib/proposal";
import {
  ProposalStatusBadge,
  type ProposalStatus,
} from "@/components/proposals/status-badge";

export const metadata = { title: "내 기안" };

export default async function MyProposalsPage() {
  const session = await requireSession();

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

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-400">
          작성한 기안이 없습니다 —{" "}
          <Link href="/proposals/new" className="text-zinc-600 underline underline-offset-2">
            기안 작성
          </Link>
          에서 시작하세요
        </div>
      )}
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`/proposals/${r.id}`}
          className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 transition hover:border-zinc-400"
        >
          <div>
            <p className="text-sm font-medium">{r.title}</p>
            <p className="mt-0.5 text-xs text-zinc-400">
              {getTemplate(r.templateKey)?.name ?? r.templateKey} ·{" "}
              {formatDateTimeKst(r.createdAt)}
              {r.status === "in_progress" &&
                ` · ${r.currentStep}/${r.totalSteps}차 결재 대기`}
            </p>
          </div>
          <ProposalStatusBadge status={r.status as ProposalStatus} />
        </Link>
      ))}
    </div>
  );
}
