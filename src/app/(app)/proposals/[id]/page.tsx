import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { proposalApprovers, proposals, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";
import { formatDateTimeKst } from "@/lib/format";
import { getTemplate } from "@/lib/proposal";
import { ActionForm } from "@/components/action-form";
import {
  ProposalStatusBadge,
  type ProposalStatus,
} from "@/components/proposals/status-badge";
import { adminForceReject, cancelProposal, decideProposal } from "../actions";

export const metadata = { title: "기안 상세" };

const STEP_META = {
  pending: { label: "대기", cls: "bg-zinc-100 text-zinc-500" },
  approved: { label: "승인", cls: "bg-emerald-50 text-emerald-600" },
  rejected: { label: "반려", cls: "bg-red-50 text-red-600" },
} as const;

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
  });
  if (!proposal) notFound();

  const [line, author] = await Promise.all([
    db
      .select({
        step: proposalApprovers.step,
        status: proposalApprovers.status,
        comment: proposalApprovers.comment,
        decidedAt: proposalApprovers.decidedAt,
        approverId: proposalApprovers.approverId,
        approverName: users.name,
        approverDept: users.department,
      })
      .from(proposalApprovers)
      .innerJoin(users, eq(proposalApprovers.approverId, users.id))
      .where(eq(proposalApprovers.proposalId, id))
      .orderBy(asc(proposalApprovers.step)),
    db.query.users.findFirst({ where: eq(users.id, proposal.authorId) }),
  ]);

  // 열람 권한: 작성자·결재선 구성원 + 관리자(감독·복구 목적 — design.md 기안 섹션)
  const isAuthor = proposal.authorId === session.user.id;
  const inLine = line.some((l) => l.approverId === session.user.id);
  if (!isAuthor && !inLine && session.user.role !== "admin") notFound();

  const template = getTemplate(proposal.templateKey);
  const content = proposal.content as Record<string, string>;
  // 렌더링은 저장 스냅샷이 기준 — 템플릿은 라벨/순서 메타데이터로만 쓴다.
  // 템플릿이 진화(필드 삭제·개명·유형 변경)해도 기존 문서 내용이 사라지면 안 된다
  const fieldMeta = new Map(template?.fields.map((f) => [f.key, f]) ?? []);
  const contentKeys = [
    ...(template?.fields.map((f) => f.key).filter((k) => k in content) ?? []),
    ...Object.keys(content).filter((k) => !fieldMeta.has(k)),
  ];
  const myTurn =
    proposal.status === "in_progress" &&
    line.some(
      (l) =>
        l.step === proposal.currentStep &&
        l.approverId === session.user.id &&
        l.status === "pending",
    );
  const canCancel =
    isAuthor &&
    proposal.status === "in_progress" &&
    line.every((l) => l.status === "pending");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-zinc-400">
              {template?.name ?? proposal.templateKey}
            </p>
            <h2 className="mt-0.5 font-semibold">{proposal.title}</h2>
            <p className="mt-1 text-xs text-zinc-400">
              {author?.name}
              {author?.department && ` (${author.department})`} ·{" "}
              {formatDateTimeKst(proposal.createdAt)}
            </p>
          </div>
          <ProposalStatusBadge status={proposal.status as ProposalStatus} />
        </div>

        <dl className="mt-4 divide-y divide-zinc-100 border-t border-zinc-100">
          {contentKeys.map((key) => {
            const meta = fieldMeta.get(key);
            const value = content[key];
            const display =
              meta?.type === "number" && Number.isFinite(Number(value))
                ? Number(value).toLocaleString("ko-KR")
                : value;
            return (
              <div key={key} className="flex gap-4 py-2 text-sm">
                <dt className="w-32 shrink-0 text-zinc-400">
                  {meta?.label ?? key}
                </dt>
                <dd className="whitespace-pre-wrap">{display}</dd>
              </div>
            );
          })}
        </dl>
      </div>

      {/* 결재선 진행 상황 */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <h3 className="text-sm font-semibold">결재선</h3>
        <ol className="mt-3 space-y-1.5">
          {line.map((l) => {
            const isCurrent =
              proposal.status === "in_progress" && l.step === proposal.currentStep;
            const meta = STEP_META[l.status];
            return (
              <li
                key={l.step}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                  isCurrent ? "border-amber-300 bg-amber-50/50" : "border-zinc-100"
                }`}
              >
                <span className="w-8 shrink-0 text-xs font-semibold text-zinc-400">
                  {l.step}차
                </span>
                <span className="flex-1">
                  {l.approverName}
                  <span className="ml-1 text-xs text-zinc-400">
                    {l.approverDept ?? "—"}
                  </span>
                  {l.comment && (
                    <p className="mt-0.5 text-xs text-zinc-500">
                      의견: {l.comment}
                    </p>
                  )}
                </span>
                {l.decidedAt && (
                  <span className="text-xs text-zinc-400">
                    {formatDateTimeKst(l.decidedAt)}
                  </span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}
                >
                  {isCurrent && l.status === "pending" ? "결재 차례" : meta.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {myTurn && (
        <ActionForm
          action={decideProposal}
          className="rounded-xl border border-amber-200 bg-amber-50/50 p-5"
        >
          <h3 className="text-sm font-semibold text-amber-800">내 결재 차례입니다</h3>
          <div className="mt-3 flex items-center gap-2">
            <input type="hidden" name="proposalId" value={proposal.id} />
            <input
              name="comment"
              placeholder="의견 (반려 시 필수)"
              className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            />
            <button
              name="action"
              value="approve"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              승인
            </button>
            <button
              name="action"
              value="reject"
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              반려
            </button>
          </div>
        </ActionForm>
      )}

      {canCancel && (
        <ActionForm action={cancelProposal}>
          <input type="hidden" name="proposalId" value={proposal.id} />
          <button className="text-xs text-zinc-400 underline-offset-2 hover:underline">
            기안 회수
          </button>
        </ActionForm>
      )}

      {/* 관리자 강제 반려 — 결재자 퇴사 등으로 멈춘 기안의 회복 경로 */}
      {session.user.role === "admin" &&
        proposal.status === "in_progress" &&
        !myTurn && (
          <ActionForm
            action={adminForceReject}
            className="rounded-xl border border-zinc-200 bg-white p-4"
          >
            <p className="text-xs text-zinc-400">
              관리자 조치 — 결재자가 결재할 수 없는 상태일 때 사유를 남기고
              강제 반려할 수 있습니다
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input
                name="comment"
                placeholder="강제 반려 사유 (필수)"
                className="flex-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm"
              />
              <button className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50">
                강제 반려
              </button>
            </div>
          </ActionForm>
        )}
    </div>
  );
}
