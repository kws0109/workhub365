import { AttendanceLeaveTabs } from "@/components/attendance-leave-tabs";
import { requireSession } from "@/lib/auth-helpers";
import { isHrEditor } from "@/lib/hr";

// 근태 세그먼트 셸 — /attendance/manage 같은 하위 라우트도 h1·탭 바를 상속받게 한다.
// metadata는 export하지 않는다(각 page.tsx의 title을 그대로 유지).
export default async function AttendanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight">근태·휴가</h1>
      <AttendanceLeaveTabs canCorrect={isHrEditor(session.user)} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
