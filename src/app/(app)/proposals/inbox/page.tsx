import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { proposalApprovers, proposals, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";
import { formatDateTimeKst } from "@/lib/format";
import { getTemplate } from "@/lib/proposal";

export const metadata = { title: "결재함" };

export default async function ProposalInboxPage() {
  const session = await requireSession();

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

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-400">
          결재 대기 중인 기안이 없습니다
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
              {getTemplate(r.templateKey)?.name ?? r.templateKey} · {r.authorName}
              {r.authorDept && ` (${r.authorDept})`} · {formatDateTimeKst(r.createdAt)}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            {r.currentStep}차 결재 차례
          </span>
        </Link>
      ))}
    </div>
  );
}
