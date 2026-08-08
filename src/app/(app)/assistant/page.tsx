import { requireRole } from "@/lib/auth-helpers";
import { AssistantChat } from "@/components/assistant/chat";

export const metadata = { title: "AI 어시스턴트" };

export default async function AssistantPage() {
  await requireRole("admin");
  return (
    <div className="flex h-full max-w-3xl flex-col">
      <h1 className="text-2xl font-bold tracking-tight">AI 어시스턴트</h1>
      <p className="mt-1 text-sm text-zinc-500">
        자연어로 라이선스·사용자·근태를 조회하고 관리 작업을 요청합니다. 계정
        생성·차단, 라이선스 회수, 세션 철회, 그룹 제거는 승인 카드에서 관리자가
        승인해야 실행됩니다.
      </p>
      <AssistantChat />
    </div>
  );
}
