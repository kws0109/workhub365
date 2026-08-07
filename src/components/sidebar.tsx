"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Role = "admin" | "manager" | "employee";

const MENU: { href: string; label: string; roles: Role[] }[] = [
  { href: "/", label: "대시보드", roles: ["admin", "manager", "employee"] },
  { href: "/leave", label: "휴가", roles: ["admin", "manager", "employee"] },
  { href: "/attendance", label: "근태", roles: ["admin", "manager", "employee"] },
  { href: "/licenses", label: "라이선스", roles: ["admin"] },
  { href: "/lifecycle", label: "온보딩/오프보딩", roles: ["admin"] },
  { href: "/assistant", label: "AI 어시스턴트", roles: ["admin"] },
  { href: "/audit", label: "감사 로그", roles: ["admin"] },
];

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3">
      {MENU.filter((m) => m.roles.includes(role)).map((m) => {
        const active =
          m.href === "/" ? pathname === "/" : pathname.startsWith(m.href);
        return (
          <Link
            key={m.href}
            href={m.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {m.label}
          </Link>
        );
      })}
    </nav>
  );
}
