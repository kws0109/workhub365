import Link from "next/link";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/db";
import { postReads, posts, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";
import { kstDateOf } from "@/lib/attendance";
import {
  POST_CATEGORY_LABEL,
  isPostCategory,
  weekStartUtc,
  type PostCategory,
} from "@/lib/board";
import { Badge, Card, PageHeader, TabLink } from "@/components/ui";

export const metadata = { title: "게시판·공지" };

// 카테고리 탭 — ?cat= 쿼리 전환 (B4)
const CATEGORY_TABS: { key: PostCategory | undefined; label: string }[] = [
  { key: undefined, label: "전체" },
  { key: "notice", label: "공지" },
  { key: "hr", label: "인사" },
  { key: "general_affairs", label: "총무" },
  { key: "free", label: "자유" },
];

/** 목업 메타 표기 (예: 8/12) — KST 기준 월/일 */
function shortDateKst(d: Date): string {
  const s = kstDateOf(d);
  return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
}

/** 고정 공지 확성기 아이콘 (목업 원본 path) */
function MegaphoneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className="h-3.5 w-3.5 shrink-0 text-amber-600"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 17v5M9 10.8 5.5 14h13L15 10.8V4.5A1.5 1.5 0 0 0 13.5 3h-3A1.5 1.5 0 0 0 9 4.5z" />
    </svg>
  );
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const session = await requireSession();
  const { cat: catParam } = await searchParams;
  const cat = catParam && isPostCategory(catParam) ? catParam : undefined;

  const listColumns = {
    id: posts.id,
    category: posts.category,
    title: posts.title,
    viewCount: posts.viewCount,
    createdAt: posts.createdAt,
    authorName: users.name,
    authorDept: users.department,
  };

  // 단일 병렬 스테이지 (페이지 쿼리 관행)
  const [pinnedRows, generalRows, unreadMustRead, popularRows] =
    await Promise.all([
      // 고정 공지 — 카테고리 탭과 무관하게 항상 상단 노출
      db
        .select(listColumns)
        .from(posts)
        .innerJoin(users, eq(posts.authorId, users.id))
        .where(eq(posts.pinned, true))
        .orderBy(desc(posts.createdAt)),
      db
        .select(listColumns)
        .from(posts)
        .innerJoin(users, eq(posts.authorId, users.id))
        .where(
          and(
            eq(posts.pinned, false),
            ...(cat ? [eq(posts.category, cat)] : []),
          ),
        )
        .orderBy(desc(posts.createdAt))
        .limit(30),
      // 내가 아직 확인하지 않은 필독 글 — 확인 이력(post_reads) 없음 기준
      db
        .select({ id: posts.id, title: posts.title })
        .from(posts)
        .leftJoin(
          postReads,
          and(
            eq(postReads.postId, posts.id),
            eq(postReads.userId, session.user.id),
          ),
        )
        .where(and(eq(posts.mustRead, true), isNull(postReads.id)))
        .orderBy(desc(posts.createdAt)),
      // 이번 주(KST 월요일~) 작성 글 중 조회수 상위 3건
      db
        .select({ id: posts.id, title: posts.title })
        .from(posts)
        .where(gte(posts.createdAt, weekStartUtc(new Date())))
        .orderBy(desc(posts.viewCount))
        .limit(3),
    ]);

  return (
    <div className="max-w-[1140px]">
      <PageHeader
        title="게시판 · 공지"
        actions={
          <>
            <nav className="flex gap-1">
              {CATEGORY_TABS.map((t) => (
                <TabLink
                  key={t.label}
                  href={t.key ? `/board?cat=${t.key}` : "/board"}
                  active={cat === t.key}
                >
                  {t.label}
                </TabLink>
              ))}
            </nav>
            <Link
              href="/board/new"
              className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white transition hover:bg-ink-body"
            >
              글쓰기
            </Link>
          </>
        }
      />

      <div className="mt-5 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* 목록 */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="divide-y divide-fill overflow-hidden">
            {pinnedRows.map((p) => (
              <Link
                key={p.id}
                href={`/board/${p.id}`}
                className="flex items-center gap-2.5 bg-canvas px-5 py-3 transition hover:bg-fill"
              >
                <MegaphoneIcon />
                <Badge tone="warn" className="shrink-0 font-semibold">
                  {POST_CATEGORY_LABEL[p.category]}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {p.title}
                </span>
                <span className="shrink-0 text-xs text-ink-muted">
                  {p.authorDept ?? p.authorName} · {shortDateKst(p.createdAt)} ·
                  조회 {p.viewCount}
                </span>
              </Link>
            ))}
            {generalRows.map((p) => (
              <Link
                key={p.id}
                href={`/board/${p.id}`}
                className="flex items-center gap-2.5 px-5 py-3 transition hover:bg-canvas"
              >
                <span className="w-3.5 shrink-0" />
                <Badge tone="neutral" className="shrink-0">
                  {POST_CATEGORY_LABEL[p.category]}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p.title}
                </span>
                <span className="shrink-0 text-xs text-ink-muted">
                  {p.authorName} · {shortDateKst(p.createdAt)} · 조회{" "}
                  {p.viewCount}
                </span>
              </Link>
            ))}
            {pinnedRows.length === 0 && generalRows.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-ink-muted">
                게시글이 없습니다 — 글쓰기에서 첫 글을 작성하세요
              </p>
            )}
          </Card>
        </div>

        {/* 우측 300px */}
        <div className="flex flex-col gap-4">
          {unreadMustRead.length > 0 && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-xs font-semibold text-amber-800">
                필독 미확인 {unreadMustRead.length}건
              </p>
              {unreadMustRead.map((p) => (
                <div key={p.id} className="mt-2">
                  <p className="text-sm font-medium">{p.title}</p>
                  <Link
                    href={`/board/${p.id}`}
                    className="mt-2 inline-block rounded-lg bg-ink px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-ink-body"
                  >
                    확인하고 읽기
                  </Link>
                </div>
              ))}
            </section>
          )}

          <Card className="p-5">
            <h2 className="text-[13px] font-semibold">이번 주 인기 글</h2>
            <div className="mt-1.5 flex flex-col divide-y divide-fill">
              {popularRows.length === 0 && (
                <p className="py-2 text-xs text-ink-muted">
                  이번 주에 작성된 글이 없습니다
                </p>
              )}
              {popularRows.map((p, i) => (
                <Link
                  key={p.id}
                  href={`/board/${p.id}`}
                  className="flex gap-2 py-2 text-[13px] transition hover:text-ink-sub"
                >
                  <span className="shrink-0 font-bold text-ink-muted">
                    {i + 1}
                  </span>
                  <span className="truncate">{p.title}</span>
                </Link>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-[13px] font-semibold">게시판 안내</h2>
            {/* R8.4 — 자체 DB(posts) 기반. SharePoint 동기화 문구는 방침과 달라 제외 (feature-map) */}
            <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
              게시판은 WorkHub365 자체 데이터베이스에 저장됩니다. 공지 작성과
              상단 고정은 관리자 전용이며, 필독 공지는 확인 이력이 기록됩니다.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
