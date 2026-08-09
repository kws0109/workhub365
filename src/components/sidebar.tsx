"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type Role = "admin" | "manager" | "employee";

/* 아이콘은 외부 라이브러리 없이 인라인 SVG — currentColor라 활성/비활성 색이 텍스트를 따라간다 (design.md M7) */
function Icon({
  children,
  className = "h-4 w-4 shrink-0",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

const ICONS = {
  home: (
    <>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v10h5v-6h4v6h5V10" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  proposal: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M9 14l2 2 4-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  license: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </>
  ),
  lifecycle: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20v-1a6 6 0 0 1 12 0v1M19 8v6M22 11h-6" />
    </>
  ),
  assistant: (
    <>
      <path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z" />
      <path d="M19 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </>
  ),
  audit: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </>
  ),
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  cloud: <path d="M18.5 19a4.5 4.5 0 0 0 .4-9A6.5 6.5 0 0 0 6.4 8.5 5 5 0 0 0 7 19z" />,
  board: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M7 8h10M7 12h6M12 18v3M8 21h8" />
    </>
  ),
  folder: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h9a1 1 0 0 1 1 1V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  door: (
    <>
      <path d="M13 3H5v18h8" />
      <path d="M13 3l6 2v14l-6 2" />
      <circle cx="10.5" cy="12" r="0.5" />
    </>
  ),
  org: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19v-1a5.5 5.5 0 0 1 11 0v1" />
      <circle cx="17.5" cy="9" r="2.5" />
      <path d="M15.5 14.5a4.5 4.5 0 0 1 5 4v.5" />
    </>
  ),
  planner: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m9 11.5 2 2 4-4.5" />
    </>
  ),
  external: (
    <>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6M10 14 21 3" />
    </>
  ),
} satisfies Record<string, ReactNode>;

type Item = { href: string; label: string; icon: keyof typeof ICONS };

const MY_MENU: Item[] = [
  { href: "/", label: "홈", icon: "home" },
  { href: "/mail", label: "메일", icon: "mail" },
  { href: "/calendar", label: "일정", icon: "calendar" },
  { href: "/proposals", label: "전자결재", icon: "proposal" },
  { href: "/attendance", label: "근태·휴가", icon: "clock" },
];

/* 협업 (M8). 메신저는 protected API 제약으로 제외 — R8.7 */
const COLLAB_MENU: Item[] = [
  { href: "/board", label: "게시판·공지", icon: "board" },
  { href: "/files", label: "문서함", icon: "folder" },
  { href: "/rooms", label: "회의실 예약", icon: "door" },
  { href: "/org", label: "조직도", icon: "org" },
];

const AI_MENU: Item[] = [
  { href: "/assistant", label: "AI 어시스턴트", icon: "assistant" },
];

const ADMIN_MENU: Item[] = [
  { href: "/licenses", label: "라이선스", icon: "license" },
  { href: "/lifecycle", label: "온보딩/오프보딩", icon: "lifecycle" },
  { href: "/audit", label: "감사 로그", icon: "audit" },
];

/* 테넌트 무관 딥링크 — 새 탭 링크만, 임베드 금지 (R7.3) */
const M365_APPS: Item[] = [
  { href: "https://outlook.office.com/mail/", label: "Outlook 메일", icon: "mail" },
  { href: "https://teams.microsoft.com/", label: "Teams", icon: "chat" },
  { href: "https://www.office.com/launch/onedrive", label: "OneDrive", icon: "cloud" },
  { href: "https://planner.cloud.microsoft/", label: "Planner", icon: "planner" },
];

export function Sidebar({
  role,
  pendingApprovals,
  unreadMail,
}: {
  role: Role;
  pendingApprovals: number;
  /** 위임 토큰 없으면 null — 배지 숨김 (강등) */
  unreadMail: number | null;
}) {
  const pathname = usePathname();

  const renderItem = (m: Item) => {
    // 근태·휴가는 두 라우트(/attendance, /leave)를 하나의 메뉴로 묶는다
    const active =
      m.href === "/"
        ? pathname === "/"
        : m.href === "/attendance"
          ? pathname.startsWith("/attendance") || pathname.startsWith("/leave")
          : pathname.startsWith(m.href);
    return (
      <Link
        key={m.href}
        href={m.href}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
          active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
        }`}
      >
        <Icon>{ICONS[m.icon]}</Icon>
        {m.label}
        {m.href === "/proposals" && pendingApprovals > 0 && (
          <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-amber-800">
            {pendingApprovals}
          </span>
        )}
        {m.href === "/mail" && unreadMail !== null && unreadMail > 0 && (
          <span
            className={`ml-auto rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
              active ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-600"
            }`}
          >
            {unreadMail > 99 ? "99+" : unreadMail}
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto p-3">
      <div className="flex flex-col gap-1">
        <p className="px-3 pb-1 text-xs font-medium text-zinc-400">내 업무</p>
        {MY_MENU.map(renderItem)}
      </div>
      <div className="flex flex-col gap-1">
        <p className="px-3 pb-1 text-xs font-medium text-zinc-400">협업</p>
        {COLLAB_MENU.map(renderItem)}
      </div>
      {/* R5.1 전직원 개방(B15) 전까지 admin 한정 — 도구 역할 차등이 먼저 필요하다 */}
      {role === "admin" && (
        <div className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-xs font-medium text-zinc-400">AI</p>
          {AI_MENU.map(renderItem)}
        </div>
      )}
      {role === "admin" && (
        <div className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-xs font-medium text-zinc-400">관리</p>
          {ADMIN_MENU.map(renderItem)}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-zinc-100 pt-3">
        <p className="px-3 pb-1 text-xs font-medium text-zinc-400">M365 앱</p>
        {M365_APPS.map((m) => (
          <a
            key={m.href}
            href={m.href}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] text-zinc-400 transition hover:bg-zinc-50 hover:text-zinc-600"
          >
            <Icon>{ICONS[m.icon]}</Icon>
            {m.label}
            <span className="ml-auto text-zinc-300 transition group-hover:text-zinc-500">
              <Icon className="h-3 w-3 shrink-0">{ICONS.external}</Icon>
            </span>
          </a>
        ))}
      </div>
    </nav>
  );
}
