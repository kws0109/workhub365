"use client";

import { usePathname } from "next/navigation";
import { TabLink } from "@/components/ui";

// B12 탭 — 결재함/내 기안. 참조 탭은 후순위(feature-map 결정), 기안 작성은
// 헤더의 primary 버튼으로 이동했다. 상세는 리다이렉트 라우트라 별도 활성 규칙 불필요
const TABS = [
  { href: "/proposals/inbox", label: "결재함" },
  { href: "/proposals", label: "내 기안" },
] as const;

export function ProposalTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1">
      {TABS.map((t) => (
        <TabLink
          key={t.href}
          href={t.href}
          active={
            t.href === "/proposals"
              ? pathname === "/proposals"
              : pathname.startsWith(t.href)
          }
        >
          {t.label}
        </TabLink>
      ))}
    </nav>
  );
}
