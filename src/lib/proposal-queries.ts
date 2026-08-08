import { cache } from "react";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { proposalApprovers, proposals } from "@/db/schema";

/**
 * "현재 내 차례"인 미결 기안 건수 — 결재함(/proposals/inbox) 목록과 동일 조건.
 * 사이드바 배지와 홈 대시보드 타일이 공용으로 사용한다 (R7.2 수용 기준: 배지 = 목록 건수).
 * cache(): 레이아웃과 페이지가 같은 요청에서 각각 호출해도 DB 왕복은 1회.
 */
export const countMyTurnProposals = cache(
  async (userId: string): Promise<number> => {
    const [{ value }] = await db
      .select({ value: count() })
      .from(proposalApprovers)
      .innerJoin(proposals, eq(proposalApprovers.proposalId, proposals.id))
      .where(
        and(
          eq(proposalApprovers.approverId, userId),
          eq(proposalApprovers.status, "pending"),
          eq(proposals.status, "in_progress"),
          eq(proposalApprovers.step, proposals.currentStep),
        ),
      );
    return value;
  },
);
