import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { proposalApprovers, proposals } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";

// B12: 상세는 마스터-디테일 화면(?sel=<id>)으로 통합됐다.
// 직접 URL·홈 위젯 딥링크가 살아 있도록 이 라우트는 리다이렉트만 담당한다
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProposalDeepLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  if (!UUID_RE.test(id)) redirect("/proposals");

  // 현재 내 차례인 문서면 결재함, 아니면 내 기안 쪽으로 보낸다
  const myTurn = await db
    .select({ id: proposalApprovers.id })
    .from(proposalApprovers)
    .innerJoin(proposals, eq(proposalApprovers.proposalId, proposals.id))
    .where(
      and(
        eq(proposalApprovers.proposalId, id),
        eq(proposalApprovers.approverId, session.user.id),
        eq(proposalApprovers.status, "pending"),
        eq(proposals.status, "in_progress"),
        eq(proposalApprovers.step, proposals.currentStep),
      ),
    )
    .limit(1);

  redirect(
    myTurn.length > 0 ? `/proposals/inbox?sel=${id}` : `/proposals?sel=${id}`,
  );
}
