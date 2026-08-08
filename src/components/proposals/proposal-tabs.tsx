"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/proposals", label: "내 기안" },
  { href: "/proposals/new", label: "기안 작성" },
  { href: "/proposals/inbox", label: "결재함" },
] as const;

export function ProposalTabs() {
  const pathname = usePathname();
  return (
    <nav className="mt-4 flex gap-1 border-b border-zinc-200">
      {TABS.map((t) => {
        // 상세(/proposals/[id])는 결재함에서도 진입하므로 어느 탭도 활성화하지 않는다
        const active =
          t.href === "/proposals"
            ? pathname === "/proposals"
            : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              active
                ? "border-zinc-900 text-zinc-900"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
