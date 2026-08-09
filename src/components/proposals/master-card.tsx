import Link from "next/link";
import type { ReactNode } from "react";

/**
 * B12 마스터 카드 — 목업 규격: radius 10, 제목+상태 배지, 메타 한 줄,
 * 선택 시 보더 ink(#18181b), 그 외 hover 시 보더만 진하게(무섀도)
 */
export function ProposalMasterCard({
  href,
  selected,
  title,
  meta,
  badge,
}: {
  href: string;
  selected: boolean;
  title: string;
  meta: string;
  badge: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={`block rounded-[10px] border bg-surface px-3.5 py-3 transition ${
        selected ? "border-ink" : "border-line hover:border-ink-muted"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{title}</p>
        {badge}
      </div>
      <p className="mt-1 truncate text-xs text-ink-muted">{meta}</p>
    </Link>
  );
}
