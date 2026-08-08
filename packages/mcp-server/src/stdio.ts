// 독립 실행 엔트리: npm run mcp:stdio
// .env.local을 다른 import보다 먼저 로드해야 하므로 dotenv 처리 후 동적 import한다.
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { runStdioServer } = await import("./server");
  // Graph/DB 구현은 Next.js와 동일한 ops를 주입한다 (도구 정의·게이트는 이 패키지가 단일 소스)
  const { createAssistantOps } = await import("../../../src/lib/assistant/ops");
  await runStdioServer(createAssistantOps());
}

void main().catch((e) => {
  console.error("[workhub365-mcp] 시작 실패:", e);
  process.exit(1);
});
