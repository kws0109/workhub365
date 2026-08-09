import { requireSession } from "@/lib/auth-helpers";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "일정" };

export default async function CalendarPage() {
  await requireSession();
  return (
    <Placeholder
      title="일정"
      phase={7}
      description="주간 타임 그리드 — Outlook calendarView (R8.2)"
    />
  );
}
