const META = {
  in_progress: { label: "진행 중", cls: "bg-blue-50 text-blue-600" },
  approved: { label: "승인", cls: "bg-emerald-50 text-emerald-600" },
  rejected: { label: "반려", cls: "bg-red-50 text-red-600" },
  cancelled: { label: "회수", cls: "bg-fill text-ink-sub" },
} as const;

export type ProposalStatus = keyof typeof META;

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  const s = META[status];
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}
