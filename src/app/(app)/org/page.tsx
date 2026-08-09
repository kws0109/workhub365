import { requireSession } from "@/lib/auth-helpers";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "조직도" };

export default async function OrgPage() {
  await requireSession();
  return (
    <Placeholder
      title="조직도"
      phase={7}
      description="부서 트리 + 인물 카드 + 휴가 배지 (R8.3)"
    />
  );
}
