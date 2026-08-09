import { requireSession } from "@/lib/auth-helpers";
import { Placeholder } from "@/components/placeholder";

export const metadata = { title: "게시판·공지" };

export default async function BoardPage() {
  await requireSession();
  return (
    <Placeholder
      title="게시판·공지"
      phase={7}
      description="카테고리·고정 공지·필독 확인 이력 (R8.4)"
    />
  );
}
