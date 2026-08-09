import { requireSession } from "@/lib/auth-helpers";
import { AssistantChat } from "@/components/assistant/chat";
import { PageHeader, SourceChip } from "@/components/ui";
import { toolsForRole } from "../../../../packages/mcp-server/src/tools";

export const metadata = { title: "AI 어시스턴트" };

// R5.1 개정(B15): 로그인한 전 직원 사용 가능. 도구는 역할별 차등 —
// employee/manager는 본인 조회 3종, admin은 전체 13종. 변경형은 승인 카드 필수.
//
// ?prompt= 프리필(B13 — 라이선스 "AI 어시스턴트로 일괄 회수" 딥링크 수신).
// 서버에서 searchParams로 읽어 초기값만 넘긴다 — useSearchParams의 Suspense
// 경계 요구를 피하고, 자동 전송 없이 입력창만 채운다(전송은 사용자 결정).
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const session = await requireSession();
  const role = session.user.role;
  const toolCount = toolsForRole(role).length;
  const { prompt } = await searchParams;
  const initialPrompt =
    typeof prompt === "string" && prompt.trim().length > 0
      ? prompt.slice(0, 2000)
      : undefined;
  return (
    <div className="flex h-full max-w-[920px] flex-col">
      <PageHeader
        title="AI 어시스턴트"
        subtitle={<SourceChip brand="ai">Claude · MCP 도구 {toolCount}종</SourceChip>}
        actions={
          <span className="text-xs text-ink-muted">
            대화는 서버에 저장되지 않습니다
          </span>
        }
      />
      <AssistantChat initialPrompt={initialPrompt} role={role} />
      <p className="mt-2.5 text-xs text-ink-muted">
        {role === "admin"
          ? "변경형 액션(계정 생성·차단, 라이선스 회수, 세션 철회, 그룹 제거)은 승인 카드를 거쳐야만 실행됩니다"
          : "내 연차·근무시간·기안 현황을 조회할 수 있습니다. 변경형 액션은 관리자 승인이 필요합니다"}
      </p>
    </div>
  );
}
