import Link from "next/link";
import { requireSession } from "@/lib/auth-helpers";
import { POST_CATEGORIES, POST_CATEGORY_LABEL } from "@/lib/board";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { createPost } from "../actions";

export const metadata = { title: "글쓰기" };

const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-line-strong";

export default async function NewPostPage() {
  const session = await requireSession();
  const isAdmin = session.user.role === "admin";

  // notice 옵션은 admin에게만 노출 — 서버 액션(createPost)에서도 재검증한다
  const categories = POST_CATEGORIES.filter(
    (c) => c !== "notice" || isAdmin,
  );

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="글쓰기"
        subtitle="게시판 · 공지"
        actions={
          <Link
            href="/board"
            className="rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-[13px] font-medium transition hover:bg-canvas"
          >
            목록으로
          </Link>
        }
      />

      <Card className="mt-5 p-5">
        <ActionForm action={createPost}>
          <div className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="post-category"
                className="text-xs font-medium text-ink-secondary"
              >
                카테고리
              </label>
              <select
                id="post-category"
                name="category"
                defaultValue="free"
                className={`mt-1.5 ${inputClass}`}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {POST_CATEGORY_LABEL[c]}
                    {c === "notice" ? " (관리자 전용)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="post-title"
                className="text-xs font-medium text-ink-secondary"
              >
                제목
              </label>
              <input
                id="post-title"
                name="title"
                required
                maxLength={200}
                placeholder="제목을 입력하세요"
                className={`mt-1.5 ${inputClass}`}
              />
            </div>

            <div>
              <label
                htmlFor="post-body"
                className="text-xs font-medium text-ink-secondary"
              >
                본문
              </label>
              <textarea
                id="post-body"
                name="body"
                required
                rows={12}
                placeholder="내용을 입력하세요"
                className={`mt-1.5 resize-y leading-relaxed ${inputClass}`}
              />
            </div>

            {isAdmin && (
              <div className="flex items-center gap-5 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="pinned" className="accent-ink" />
                  상단 고정
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="mustRead"
                    className="accent-ink"
                  />
                  필독 (확인 이력 기록)
                </label>
              </div>
            )}

            <div>
              <button
                type="submit"
                className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white transition hover:bg-ink-body"
              >
                등록
              </button>
            </div>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
