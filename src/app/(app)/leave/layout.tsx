import { AttendanceLeaveTabs } from "@/components/attendance-leave-tabs";

export const metadata = { title: "휴가" };

export default function LeaveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight">근태·휴가</h1>
      <AttendanceLeaveTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
