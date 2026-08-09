// 게시판 (B4/R8.4) — 순수 로직·상수. UI와 분리해 단위 테스트를 붙인다.
// 주 경계 규칙은 근태와 동일(KST 월요일 00:00) — lib/attendance 헬퍼를 재사용한다.

import { weekStartKst } from "@/lib/attendance";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const POST_CATEGORIES = [
  "notice",
  "hr",
  "general_affairs",
  "free",
] as const;

export type PostCategory = (typeof POST_CATEGORIES)[number];

export const POST_CATEGORY_LABEL: Record<PostCategory, string> = {
  notice: "공지",
  hr: "인사",
  general_affairs: "총무",
  free: "자유",
};

export function isPostCategory(v: string): v is PostCategory {
  return (POST_CATEGORIES as readonly string[]).includes(v);
}

/** 해당 시각이 속한 KST 주(월요일 00:00)의 시작을 UTC 시각으로 — "이번 주 인기 글" 경계 */
export function weekStartUtc(at: Date): Date {
  return new Date(
    Date.parse(`${weekStartKst(at)}T00:00:00Z`) - KST_OFFSET_MS,
  );
}
