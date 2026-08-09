import { requireSession } from "@/lib/auth-helpers";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "메일" };

export default async function MailPage() {
  await requireSession();
  return (
    <Placeholder
      title="메일"
      phase={7}
      description="Outlook 3패널 읽기 — 폴더·목록·본문 (R8.1)"
    />
  );
}
