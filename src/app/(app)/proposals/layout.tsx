import { ProposalTabs } from "@/components/proposals/proposal-tabs";

export const metadata = { title: "기안" };

export default function ProposalsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight">기안</h1>
      <ProposalTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
