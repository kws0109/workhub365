import { requireRole } from "@/lib/auth-helpers";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "온보딩/오프보딩" };

export default async function LifecyclePage() {
  await requireRole("admin");
  return (
    <Placeholder
      title="온보딩/오프보딩"
      phase={3}
      description="계정 생성→라이선스→그룹 배정 / 차단→세션 철회→회수→제거 파이프라인"
    />
  );
}
