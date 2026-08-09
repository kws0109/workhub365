"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabClass } from "@/components/ui";

// 근태·휴가는 라우트를 통합하지 않고 상단 세그먼트 탭으로 상호 이동한다 (Phase 7 결정,
// 사이드바 단일 메뉴와 짝) — /attendance와 /leave 레이아웃 양쪽에서 사용
const TABS = [
  { href: "/attendance", label: "근태" },
  { href: "/leave", label: "휴가 캘린더 · 신청" },
  { href: "/leave/team", label: "팀 연차 현황" },
] as const;

export function AttendanceLeaveTabs() {
  const pathname = usePathname();
  return (
    <nav className="mt-4 flex gap-1">
      {TABS.map((t) => {
        const active =
          t.href === "/leave" ? pathname === "/leave" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={tabClass(active)}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
