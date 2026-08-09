import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { proposalApprovers, proposals, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";
import { formatDateTimeKst } from "@/lib/format";
import { getTemplate } from "@/lib/proposal";
import { Badge, Card } from "@/components/ui";
import { ProposalMasterCard } from "@/components/proposals/master-card";
import { ProposalDetail } from "@/components/proposals/proposal-detail";

export const metadata = { title: "결재함" };

// B12 마스터-디테일 — 내 차례 문서 리스트 + 상세·결재 액션을 한 화면에서 처리한다.
// 선택은 ?sel=<id>(기본: 첫 항목), 서버 컴포넌트 유지
export default async function ProposalInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ sel?: string }>;
}) {
  const session = await requireSession();
  const { sel } = await searchParams;

  const author = alias(users, "author");
  // 내가 현재 차례(step = currentStep)의 대기 결재자인 기안
  const rows = await db
    .select({
      id: proposals.id,
      templateKey: proposals.templateKey,
      title: proposals.title,
      currentStep: proposals.currentStep,
      createdAt: proposals.createdAt,
      authorName: author.name,
      authorDept: author.department,
    })
    .from(proposalApprovers)
    .innerJoin(proposals, eq(proposalApprovers.proposalId, proposals.id))
    .innerJoin(author, eq(proposals.authorId, author.id))
    .where(
      and(
        eq(proposalApprovers.approverId, session.user.id),
        eq(proposalApprovers.status, "pending"),
        eq(proposals.status, "in_progress"),
        eq(proposalApprovers.step, proposals.currentStep),
      ),
    )
    .orderBy(desc(proposals.createdAt));

  // 결재 처리 직후처럼 sel이 목록 밖이어도 디테일은 처리 결과를 계속 보여준다 (빈 문자열은 기본값으로)
  const selId = sel || rows[0]?.id;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        {rows.length === 0 && (
          <div className="rounded-[10px] border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-ink-muted">
            결재 대기 중인 기안이 없습니다
          </div>
        )}
        {rows.map((r) => (
          <ProposalMasterCard
            key={r.id}
            href={`/proposals/inbox?sel=${r.id}`}
            selected={r.id === selId}
            title={r.title}
            meta={`${getTemplate(r.templateKey)?.name ?? r.templateKey} · ${r.authorName}${
              r.authorDept ? ` (${r.authorDept})` : ""
            } · ${formatDateTimeKst(r.createdAt)}`}
            badge={<Badge tone="warn">{r.currentStep}차 차례</Badge>}
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
