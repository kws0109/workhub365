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

// 인사 정정 권한자(hr_admin·admin)에게만 붙는 4번째 탭 — 권한 판정은 레이아웃(서버)에서
const HR_TAB = { href: "/attendance/manage", label: "인사 정정" } as const;

export function AttendanceLeaveTabs({ canCorrect = false }: { canCorrect?: boolean }) {
  const pathname = usePathname();
  const tabs = canCorrect ? [...TABS, HR_TAB] : TABS;
  return (
    <nav className="mt-4 flex gap-1">
      {tabs.map((t) => {
        // 네 탭 모두 하위 라우트가 없으므로 exact 매칭 — startsWith면 /attendance/manage에서
        // '근태'와 '인사 정정'이 동시에 active가 되고 aria-current가 2개 붙는다(접근성 위반)
        const active = pathname === t.href;
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
