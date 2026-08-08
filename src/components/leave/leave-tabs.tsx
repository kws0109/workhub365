"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/leave", label: "캘린더 · 신청" },
  { href: "/leave/team", label: "팀 연차 현황" },
] as const;

export function LeaveTabs() {
  const pathname = usePathname();
  return (
    <nav className="mt-4 flex gap-1 border-b border-zinc-200">
      {TABS.map((t) => {
        const active =
          t.href === "/leave" ? pathname === "/leave" : pathname.startsWith(t.href);
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
