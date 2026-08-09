import { requireSession } from "@/lib/auth-helpers";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "회의실 예약" };

export default async function RoomsPage() {
  await requireSession();
  return (
    <Placeholder
      title="회의실 예약"
      phase={7}
      description="회의실×시간 가용성 그리드 + 예약 (R8.6)"
    />
  );
}
