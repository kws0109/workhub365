import { db } from "@/db";
import { requireSession } from "@/lib/auth-helpers";
import { ProposalForm } from "@/components/proposals/proposal-form";
import { createProposal } from "../actions";

export const metadata = { title: "기안 작성" };

export default async function NewProposalPage() {
  const session = await requireSession();

  const allUsers = await db.query.users.findMany();
  const me = allUsers.find((u) => u.id === session.user.id);
  if (!me) return null;

  const toLike = (u: typeof me) => ({
    id: u.id,
    name: u.name,
    department: u.department,
    role: u.role,
  });

  return (
    // B12 셸(max-w 1240) 안에서 폼은 읽기 좋은 폭으로 제한한다
    <div className="max-w-3xl">
      <ProposalForm
        action={createProposal}
        author={toLike(me)}
        allUsers={allUsers.map(toLike)}
      />
    </div>
  );
}
