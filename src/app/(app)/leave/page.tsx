import { requireSession } from "@/lib/auth-helpers";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "휴가" };

export default async function LeavePage() {
  await requireSession();
  return (
    <Placeholder
      title="휴가"
      phase={4}
      description="휴가 신청 → 결재선 승인 → 잔여 연차 차감, 팀 캘린더"
    />
  );
}
