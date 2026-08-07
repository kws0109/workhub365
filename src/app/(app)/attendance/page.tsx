import { requireSession } from "@/lib/auth-helpers";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "근태" };

export default async function AttendancePage() {
  await requireSession();
  return (
    <Placeholder
      title="근태"
      phase={4}
      description="출퇴근 체크인/아웃, 주간 집계, 52시간 경고"
    />
  );
}
