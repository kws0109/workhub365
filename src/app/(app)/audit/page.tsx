import { requireRole } from "@/lib/auth-helpers";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "감사 로그" };

export default async function AuditPage() {
  await requireRole("admin");
  return (
    <Placeholder
      title="감사 로그"
      phase={3}
      description="관리 쓰기 액션의 실행자/대상/시각/결과 기록 조회"
    />
  );
}
