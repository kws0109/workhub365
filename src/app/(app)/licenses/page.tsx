import { requireRole } from "@/lib/auth-helpers";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "라이선스" };

export default async function LicensesPage() {
  await requireRole("admin");
  return (
    <Placeholder
      title="라이선스"
      phase={2}
      description="SKU 현황, 비활성 사용자×라이선스 매트릭스, 낭비 금액, 다운그레이드 추천"
    />
  );
}
