"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { postReads, posts } from "@/db/schema";
import { assertRole } from "@/lib/auth-helpers";
import { isPostCategory } from "@/lib/board";
import type { ActionState } from "@/components/action-form";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 게시판 쓰기는 자체 콘텐츠 — 관리 쓰기 액션이 아니므로 감사 로그를 남기지 않는다.
// 단 notice 카테고리·pinned·mustRead는 admin 전용이며 반드시 서버에서 검증한다.

export async function createPost(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin", "manager", "employee");
  const isAdmin = session.user.role === "admin";

  const category = String(formData.get("category") ?? "");
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const body = String(formData.get("body") ?? "").trim().slice(0, 20_000);

  if (!isPostCategory(category)) {
    return { error: "카테고리가 올바르지 않습니다" };
  }
  if (!title || !body) {
    return { error: "제목과 본문을 입력하세요" };
  }
  // 폼에서 notice 옵션을 숨기는 것만으로는 부족 — 서버에서 재검증 (R8.4)
  if (category === "notice" && !isAdmin) {
    return { error: "공지 카테고리는 관리자만 작성할 수 있습니다" };
  }
  // 고정·필독 플래그도 admin 외 입력은 무시한다
  const pinned = isAdmin && formData.get("pinned") === "on";
  const mustRead = isAdmin && formData.get("mustRead") === "on";

  const [created] = await db
    .insert(posts)
    .values({
      category,
      title,
      body,
      authorId: session.user.id,
      pinned,
      mustRead,
    })
    .returning({ id: posts.id });

  revalidatePath("/board");
  redirect(`/board/${created.id}`);
}

/** 필독 확인 — post_reads upsert. (postId,userId) 유니크로 1인 1회 */
export async function markPostRead(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await assertRole("admin", "manager", "employee");
  const postId = String(formData.get("postId") ?? "");
  if (!UUID_RE.test(postId)) return { error: "입력이 올바르지 않습니다" };

  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    columns: { id: true, mustRead: true },
  });
  if (!post) return { error: "글을 찾을 수 없습니다" };
  if (!post.mustRead) return { error: "필독 글이 아닙니다" };

  await db
    .insert(postReads)
    .values({ postId, userId: session.user.id })
    .onConflictDoNothing();

  revalidatePath(`/board/${postId}`);
  revalidatePath("/board");
  return { ok: true };
}

/** 고정/필독 토글 (admin) */
export async function togglePostFlag(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertRole("admin");
  const postId = String(formData.get("postId") ?? "");
  const flag = String(formData.get("flag") ?? "");
  if (!UUID_RE.test(postId) || (flag !== "pinned" && flag !== "mustRead")) {
    return { error: "입력이 올바르지 않습니다" };
  }

  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    columns: { pinned: true, mustRead: true },
  });
  if (!post) return { error: "글을 찾을 수 없습니다" };

  await db
    .update(posts)
    .set(flag === "pinned" ? { pinned: !post.pinned } : { mustRead: !post.mustRead })
    .where(eq(posts.id, postId));

  revalidatePath(`/board/${postId}`);
  revalidatePath("/board");
  return { ok: true };
}

/** 삭제 (admin) — 단순 delete. FK 때문에 확인 이력을 먼저 지운다 */
export async function deletePost(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertRole("admin");
  const postId = String(formData.get("postId") ?? "");
  if (!UUID_RE.test(postId)) return { error: "입력이 올바르지 않습니다" };

  await db.transaction(async (tx) => {
    await tx.delete(postReads).where(eq(postReads.postId, postId));
    await tx.delete(posts).where(eq(posts.id, postId));
  });

  revalidatePath("/board");
  redirect("/board");
}
