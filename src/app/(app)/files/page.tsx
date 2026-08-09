import { requireSession } from "@/lib/auth-helpers";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "문서함" };

export default async function FilesPage() {
  await requireSession();
  return (
    <Placeholder
      title="문서함"
      phase={7}
      description="OneDrive 읽기 + 저장 공간 게이지 (R8.5)"
    />
  );
}
