import { and, count, eq } from "drizzle-orm";
import { signOut } from "@/auth";
import { db } from "@/db";
import { proposalApprovers, proposals } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";
import { Sidebar } from "@/components/sidebar";

const ROLE_LABEL = {
  admin: "관리자",
  manager: "결재자",
  employee: "직원",
} as const;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const { role, name } = { role: session.user.role, name: session.user.name };

  // 기안 미결 배지 — 결재함(proposals/inbox)과 동일 조건의 count. 렌더 시점 스냅샷,
  // 결재 액션의 revalidatePath로 갱신된다 (신선도 방침은 design.md M7)
  const [{ value: pendingApprovals }] = await db
    .select({ value: count() })
    .from(proposalApprovers)
    .innerJoin(proposals, eq(proposalApprovers.proposalId, proposals.id))
    .where(
      and(
        eq(proposalApprovers.approverId, session.user.id),
        eq(proposalApprovers.status, "pending"),
        eq(proposals.status, "in_progress"),
        eq(proposalApprovers.step, proposals.currentStep),
      ),
    );

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-5 py-4">
          <span className="text-lg font-bold tracking-tight">WorkHub365</span>
        </div>
        <Sidebar role={role} pendingApprovals={pendingApprovals} />
        <div className="mt-auto border-t border-zinc-200 p-4">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-zinc-500">{ROLE_LABEL[role]}</p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="mt-2 text-xs text-zinc-400 underline-offset-2 hover:underline"
            >
              로그아웃
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
