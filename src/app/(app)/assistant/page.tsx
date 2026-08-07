import { requireRole } from "@/lib/auth-helpers";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "AI 어시스턴트" };

export default async function AssistantPage() {
  await requireRole("admin");
  return (
    <Placeholder
      title="AI 어시스턴트"
      phase={5}
      description="자연어 관리 액션 + 승인 카드 (human-in-the-loop)"
    />
  );
}
