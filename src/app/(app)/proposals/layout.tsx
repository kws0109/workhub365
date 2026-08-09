import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { ProposalTabs } from "@/components/proposals/proposal-tabs";

export const metadata = { title: "전자결재" };

// B12 셸 — PageHeader + 탭(결재함/내 기안) + 기안 작성 primary 버튼, max-w 1240(목업 규격)
export default function ProposalsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-[1240px]">
      <PageHeader
        title="전자결재"
        actions={
          <>
            <ProposalTabs />
            <Link
              href="/proposals/new"
              className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white transition hover:bg-ink-body"
            >
              기안 작성
            </Link>
          </>
        }
      />
      <div className="mt-5">{children}</div>
    </div>
  );
}
