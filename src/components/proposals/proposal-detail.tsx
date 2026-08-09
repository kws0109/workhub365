import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { proposalApprovers, proposals, users } from "@/db/schema";
import { formatDateTimeKst } from "@/lib/format";
import { getTemplate } from "@/lib/proposal";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, type BadgeTone } from "@/components/ui";
import {
  ProposalStatusBadge,
  type ProposalStatus,
} from "@/components/proposals/status-badge";
import {
  adminForceReject,
  cancelProposal,
  decideProposal,
} from "@/app/(app)/proposals/actions";

// B12 디테일 — 내 기안/결재함 두 마스터-디테일 화면이 공유하는 상세 렌더링.
// 기존 /proposals/[id] 페이지의 구성을 추출했고, 상태 전이·서버 액션은 그대로 재사용한다.

const STEP_META: Record<
  "pending" | "approved" | "rejected",
  { label: string; tone: BadgeTone }
> = {
  pending: { label: "대기", tone: "neutral" },
  approved: { label: "승인", tone: "success" },
  rejected: { label: "반려", tone: "danger" },
};

// 처리 결과 노트 (목업 decidedDone 노트) — 종결 상태에서만 표시
const RESULT_NOTE = {
  approved: {
    cls: "bg-emerald-50 text-emerald-700",
    text: "모든 결재가 완료되어 승인된 문서입니다",
  },
  rejected: {
    cls: "bg-red-50 text-red-600",
    text: "반려된 문서입니다 — 결재선의 의견을 확인하세요",
  },
  cancelled: {
    cls: "bg-fill text-ink-sub",
    text: "기안자가 회수한 문서입니다",
  },
} as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function DetailFallback() {
  return (
    <Card className="p-10 text-center text-sm text-ink-muted">
      문서를 찾을 수 없거나 열람 권한이 없습니다
    </Card>
  );
}

export async function ProposalDetail({
  proposalId,
  viewerId,
  viewerRole,
}: {
  proposalId: string;
  viewerId: string;
  viewerRole: "admin" | "manager" | "employee";
}) {
  // sel 쿼리는 외부 입력 — uuid 형태가 아니면 DB 캐스팅 오류 전에 걸러낸다
  if (!UUID_RE.test(proposalId)) return <DetailFallback />;

  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, proposalId),
  });
  if (!proposal) return <DetailFallback />;

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
      .where(eq(proposalApprovers.proposalId, proposalId))
      .orderBy(asc(proposalApprovers.step)),
    db.query.users.findFirst({ where: eq(users.id, proposal.authorId) }),
  ]);

  // 열람 권한: 작성자·결재선 구성원 + 관리자(감독·복구 목적 — design.md 기안 섹션)
  const isAuthor = proposal.authorId === viewerId;
  const inLine = line.some((l) => l.approverId === viewerId);
  if (!isAuthor && !inLine && viewerRole !== "admin") return <DetailFallback />;

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
        l.approverId === viewerId &&
        l.status === "pending",
    );
  const canCancel =
    isAuthor &&
    proposal.status === "in_progress" &&
    line.every((l) => l.status === "pending");

  return (
    <div className="flex flex-col gap-4">
      {/* 문서 카드 — 유형·제목 16/600·dl 행(dt 128px) */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-ink-muted">
              {template?.name ?? proposal.templateKey}
            </p>
            <h2 className="mt-0.5 text-base font-semibold">{proposal.title}</h2>
            <p className="mt-1 text-xs text-ink-muted">
              {author?.name}
              {author?.department && ` (${author.department})`} ·{" "}
              {formatDateTimeKst(proposal.createdAt)} 상신
            </p>
          </div>
          <ProposalStatusBadge status={proposal.status as ProposalStatus} />
        </div>

        <dl className="mt-4 divide-y divide-fill border-t border-fill">
          {contentKeys.map((key) => {
            const meta = fieldMeta.get(key);
            const value = content[key];
            const isNumber =
              meta?.type === "number" && Number.isFinite(Number(value));
            const display = isNumber
              ? Number(value).toLocaleString("ko-KR")
              : value;
            return (
              <div key={key} className="flex gap-4 py-2 text-sm">
                <dt className="w-32 shrink-0 text-ink-muted">
                  {meta?.label ?? key}
                </dt>
                <dd
                  className={`whitespace-pre-wrap ${isNumber ? "font-semibold tabular-nums" : ""}`}
                >
                  {display}
                </dd>
              </div>
            );
          })}
        </dl>
      </Card>

      {/* 결재선 카드 — 현재 차례 amber 강조 + 순차 결재 캡션 */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold">결재선</h3>
        <ol className="mt-3 space-y-1.5">
          {line.map((l) => {
            const isCurrent =
              proposal.status === "in_progress" &&
              l.step === proposal.currentStep;
            const meta = STEP_META[l.status];
            const isTurn = isCurrent && l.status === "pending";
            return (
              <li
                key={l.step}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                  isCurrent ? "border-amber-300 bg-amber-50" : "border-fill"
                }`}
              >
                <span className="w-8 shrink-0 text-xs font-semibold text-ink-muted">
                  {l.step}차
                </span>
                <span className="min-w-0 flex-1">
                  {l.approverName}
                  <span className="ml-1 text-xs text-ink-muted">
                    {l.approverDept ?? "—"}
                  </span>
                  {l.comment && (
                    <p className="mt-0.5 text-xs text-ink-secondary">
                      의견: {l.comment}
                    </p>
                  )}
                </span>
                {l.decidedAt && (
                  <span className="text-xs text-ink-muted tabular-nums">
                    {formatDateTimeKst(l.decidedAt)}
                  </span>
                )}
                <Badge
                  tone={isTurn ? "warn" : meta.tone}
                  className="shrink-0 text-xs"
                >
                  {isTurn ? "결재 차례" : meta.label}
                </Badge>
              </li>
            );
          })}
        </ol>
        <p className="mt-2.5 text-xs text-ink-muted">
          순차 결재 · 1차부터 순서대로 결재가 진행됩니다
        </p>
      </Card>

      {/* 내 차례 액션 카드 (amber) — 기존 서버 액션 재사용 */}
      {myTurn && (
        <ActionForm
          action={decideProposal}
          className="rounded-xl border border-amber-200 bg-amber-50 p-5"
        >
          <h3 className="text-sm font-semibold text-amber-800">
            내 결재 차례입니다
          </h3>
          <div className="mt-3 flex items-center gap-2">
            <input type="hidden" name="proposalId" value={proposal.id} />
            <input
              name="comment"
              placeholder="의견 (반려 시 필수)"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-line-strong"
            />
            <button
              name="action"
              value="approve"
              className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              승인
            </button>
            <button
              name="action"
              value="reject"
              className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
            >
              반려
            </button>
          </div>
        </ActionForm>
      )}

      {/* 처리 결과 노트 — 종결 상태 안내 */}
      {proposal.status !== "in_progress" && (
        <div
          className={`rounded-xl px-5 py-3.5 text-[13px] font-medium ${RESULT_NOTE[proposal.status as keyof typeof RESULT_NOTE].cls}`}
        >
          {RESULT_NOTE[proposal.status as keyof typeof RESULT_NOTE].text}
        </div>
      )}

      {canCancel && (
        <ActionForm action={cancelProposal}>
          <input type="hidden" name="proposalId" value={proposal.id} />
          <button className="text-xs text-ink-muted underline-offset-2 hover:underline">
            기안 회수
          </button>
        </ActionForm>
      )}

      {/* 관리자 강제 반려 — 결재자 퇴사 등으로 멈춘 기안의 회복 경로 */}
      {viewerRole === "admin" && proposal.status === "in_progress" && !myTurn && (
        <ActionForm action={adminForceReject} className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-ink-muted">
            관리자 조치 — 결재자가 결재할 수 없는 상태일 때 사유를 남기고 강제
            반려할 수 있습니다
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input type="hidden" name="proposalId" value={proposal.id} />
            <input
              name="comment"
              placeholder="강제 반려 사유 (필수)"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none placeholder:text-ink-muted focus:border-line-strong"
            />
            <button className="shrink-0 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50">
              강제 반려
            </button>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
