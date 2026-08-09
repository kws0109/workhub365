import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { postReads, posts, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";
import { POST_CATEGORY_LABEL } from "@/lib/board";
import { formatDateKst, formatDateTimeKst } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { deletePost, markPostRead, togglePostFlag } from "../actions";

export const metadata = { title: "게시글" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const adminButtonClass =
  "rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium transition hover:bg-canvas";

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const isAdmin = session.user.role === "admin";

  // 조회수 increment — 중복 방지 없음 (같은 사람의 재열람·새로고침도 +1).
  // 데모 수준으로 충분하다는 스펙 결정 (design.md M8)
  const [post] = await db
    .update(posts)
    .set({ viewCount: sql`${posts.viewCount} + 1` })
    .where(eq(posts.id, id))
    .returning();
  if (!post) notFound();

  const [author, myRead] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, post.authorId),
      columns: { name: true, department: true },
    }),
    post.mustRead
      ? db.query.postReads.findFirst({
          where: and(
            eq(postReads.postId, post.id),
            eq(postReads.userId, session.user.id),
          ),
        })
      : Promise.resolve(undefined),
  ]);

  return (
    <div className="max-w-[920px]">
      <PageHeader
        title="게시판 · 공지"
        actions={
          <Link
            href="/board"
            className="rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-[13px] font-medium transition hover:bg-canvas"
          >
            목록으로
          </Link>
        }
      />

      <Card className="mt-5 p-6">
        {/* 제목 + 메타 */}
        <div className="flex items-center gap-2">
          <Badge
            tone={post.category === "notice" ? "warn" : "neutral"}
            className={post.category === "notice" ? "font-semibold" : ""}
          >
            {POST_CATEGORY_LABEL[post.category]}
          </Badge>
          {post.pinned && <Badge tone="neutral">상단 고정</Badge>}
          {post.mustRead && <Badge tone="danger">필독</Badge>}
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-[-0.01em]">
          {post.title}
        </h2>
        <p className="mt-1.5 text-xs text-ink-muted">
          {author?.name ?? "알 수 없음"}
          {author?.department ? ` · ${author.department}` : ""} ·{" "}
          {formatDateKst(post.createdAt)} · 조회 {post.viewCount}
        </p>

        {/* admin 관리 액션 — 고정/필독 토글 + 삭제 */}
        {isAdmin && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-fill pt-3">
            <ActionForm action={togglePostFlag}>
              <input type="hidden" name="postId" value={post.id} />
              <input type="hidden" name="flag" value="pinned" />
              <button className={adminButtonClass}>
                {post.pinned ? "고정 해제" : "상단 고정"}
              </button>
            </ActionForm>
            <ActionForm action={togglePostFlag}>
              <input type="hidden" name="postId" value={post.id} />
              <input type="hidden" name="flag" value="mustRead" />
              <button className={adminButtonClass}>
                {post.mustRead ? "필독 해제" : "필독 지정"}
              </button>
            </ActionForm>
            <ActionForm action={deletePost}>
              <input type="hidden" name="postId" value={post.id} />
              <button className="rounded-lg border border-red-200 bg-surface px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50">
                삭제
              </button>
            </ActionForm>
          </div>
        )}

        {/* 본문 */}
        <div className="mt-5 whitespace-pre-wrap border-t border-fill pt-5 text-sm leading-7 text-ink-body">
          {post.body}
        </div>

        {/* 필독 확인 */}
        {post.mustRead && (
          <div className="mt-6 border-t border-fill pt-4">
            {myRead ? (
              <p className="text-sm text-emerald-600">
                확인 완료 · {formatDateTimeKst(myRead.readAt)}
              </p>
            ) : (
              <ActionForm action={markPostRead}>
                <input type="hidden" name="postId" value={post.id} />
                <button className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white transition hover:bg-ink-body">
                  확인했습니다
                </button>
                <p className="mt-1.5 text-xs text-ink-muted">
                  필독 공지입니다 — 확인 이력이 기록됩니다
                </p>
              </ActionForm>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
