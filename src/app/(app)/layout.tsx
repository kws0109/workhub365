import { eq } from "drizzle-orm";
import { signOut } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";
import { countMyTurnProposals } from "@/lib/proposal-queries";
import { cachedGraph } from "@/lib/graph/cache";
import { getDelegatedGraphToken } from "@/lib/graph/delegated";
import { getInboxUnreadCount } from "@/lib/graph/me";
import { Sidebar } from "@/components/sidebar";

const ROLE_LABEL = {
  admin: "관리자",
  manager: "결재자",
  employee: "직원",
} as const;

/** 사이드바 메일 배지 — 사용자별 60초 캐시 스냅샷 (M7 신선도 방침), 실패 시 숨김 */
async function unreadMailBadge(userId: string): Promise<number | null> {
  try {
    const token = await getDelegatedGraphToken();
    if (!token) return null;
    return await cachedGraph(`me:unread:${userId}`, 60_000, () =>
      getInboxUnreadCount(token),
    );
  } catch {
    return null;
  }
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const { role, name } = { role: session.user.role, name: session.user.name };

  // 기안 미결 배지 — 렌더 시점 스냅샷, 결재 액션의 revalidatePath로 갱신 (design.md M7)
  const [pendingApprovals, me, unreadMail] = await Promise.all([
    countMyTurnProposals(session.user.id),
    db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { department: true },
    }),
    unreadMailBadge(session.user.id),
  ]);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
        <div className="border-b border-line px-5 py-4">
          <span className="text-lg font-bold tracking-[-0.02em]">
            WorkHub365
          </span>
        </div>
        <Sidebar
          role={role}
          pendingApprovals={pendingApprovals}
          unreadMail={unreadMail}
        />
        <div className="mt-auto border-t border-line p-4">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-ink-secondary">
            {me?.department ? `${me.department} · ` : ""}
            {ROLE_LABEL[role]}
          </p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="mt-2 text-xs text-ink-muted underline-offset-2 hover:underline"
            >
              로그아웃
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
