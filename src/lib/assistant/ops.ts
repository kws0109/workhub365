import { randomBytes } from "node:crypto";
import { and, desc, gte, lt, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceRecords, leaveRequests, proposals, users } from "@/db/schema";
import {
  getLicenseUsers,
  getSubscribedSkus,
} from "@/lib/graph/licenses";
import {
  addUserToGroup,
  createUser as graphCreateUser,
  getDefaultDomain,
  getDirectoryUsers,
  getGroups,
  getUserGroupIds,
  getUserLicenseSkuIds,
  removeUserFromGroup,
  revokeSignInSessions,
  setAccountEnabled,
  setUserLicenses,
} from "@/lib/graph/users";
import { bustGraphCache } from "@/lib/graph/cache";
import { calcLicenseWaste } from "@/lib/license-waste";
import { buildPriceMap } from "@/lib/sku-prices";
import {
  WEEKLY_OVER_MINUTES,
  aggregateWeeklyMinutes,
  overtimeLevel,
  weekStartKst,
} from "@/lib/attendance";
import { generateTempPassword } from "@/lib/lifecycle";
import { countMyTurnProposals } from "@/lib/proposal-queries";
import type { ToolContext } from "../../../packages/mcp-server/src/types";

// AI 어시스턴트 도구의 ToolContext 실제 구현.
// Next.js /api/assistant와 stdio MCP 서버가 동일 구현을 주입받는다.
// 승인 게이트는 packages/mcp-server의 executeTool이 강제하므로 여기서는
// 변경형 메서드도 단순 위임이다 — 이 모듈을 직접 import해 게이트를 우회하지 말 것.

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function createAssistantOps(): ToolContext {
  return {
    async getLicenseOverview(inactiveDays) {
      const [skus, licenseUsers] = await Promise.all([
        getSubscribedSkus(),
        getLicenseUsers(),
      ]);
      const prices = await buildPriceMap(skus);
      const report = calcLicenseWaste({
        users: licenseUsers.users,
        skus,
        prices,
        inactiveDays,
        signInAvailable: licenseUsers.signInAvailable,
        now: new Date(),
      });
      return {
        inactiveDays,
        signInAvailable: licenseUsers.signInAvailable,
        totalsKrw: {
          unassigned: report.totals.unassignedWasteKrw,
          assigned: report.totals.assignedWasteKrw,
          total: report.totals.totalWasteKrw,
        },
        skus: report.skuSummaries.map((s) => ({
          skuPartNumber: s.skuPartNumber,
          displayName: s.displayName,
          purchased: s.total,
          assigned: s.assigned,
          unassigned: s.unassigned,
          monthlyPriceKrw: s.monthlyPriceKrw,
        })),
        topWasteUsers: report.userRows
          .filter((r) => r.monthlyWasteKrw > 0)
          .sort((a, b) => b.monthlyWasteKrw - a.monthlyWasteKrw)
          .slice(0, 15)
          .map((r) => ({
            displayName: r.displayName,
            userPrincipalName: r.userPrincipalName,
            status: r.status,
            monthlyWasteKrw: r.monthlyWasteKrw,
          })),
      };
    },

    async findUsers(query) {
      const q = query.trim().toLowerCase();
      const all = await getDirectoryUsers();
      return all
        .filter(
          (u) =>
            u.displayName.toLowerCase().includes(q) ||
            u.userPrincipalName.toLowerCase().includes(q) ||
            (u.department ?? "").toLowerCase().includes(q),
        )
        .map((u) => ({
          id: u.id,
          displayName: u.displayName,
          userPrincipalName: u.userPrincipalName,
          department: u.department ?? null,
          jobTitle: u.jobTitle ?? null,
          accountEnabled: u.accountEnabled,
        }));
    },

    async getUserDetail(userId) {
      const all = await getDirectoryUsers();
      const user = all.find((u) => u.id === userId);
      if (!user) return null;
      const [skuIds, groups, skus] = await Promise.all([
        getUserLicenseSkuIds(userId),
        getUserGroupIds(userId),
        getSubscribedSkus(),
      ]);
      const partNumberOf = new Map(skus.map((s) => [s.skuId, s.skuPartNumber]));
      return {
        id: user.id,
        displayName: user.displayName,
        userPrincipalName: user.userPrincipalName,
        department: user.department ?? null,
        jobTitle: user.jobTitle ?? null,
        accountEnabled: user.accountEnabled,
        licenses: skuIds.map((skuId) => ({
          skuId,
          skuPartNumber: partNumberOf.get(skuId) ?? "(알 수 없음)",
        })),
        groups,
      };
    },

    async getOvertimeStatus() {
      const weekStart = weekStartKst(new Date());
      const weekEnd = addDaysToDateStr(weekStart, 7);
      const rows = await db
        .select({
          userId: attendanceRecords.userId,
          date: attendanceRecords.date,
          workedMinutes: attendanceRecords.workedMinutes,
          name: users.name,
          department: users.department,
        })
        .from(attendanceRecords)
        .innerJoin(users, eq(users.id, attendanceRecords.userId))
        .where(and(gte(attendanceRecords.date, weekStart), lt(attendanceRecords.date, weekEnd)));

      const byUser = new Map<
        string,
        { name: string; department: string | null; records: { date: string; workedMinutes: number | null }[] }
      >();
      for (const r of rows) {
        const entry = byUser.get(r.userId) ?? {
          name: r.name,
          department: r.department,
          records: [],
        };
        entry.records.push({ date: r.date, workedMinutes: r.workedMinutes });
        byUser.set(r.userId, entry);
      }
      return {
        weekStart,
        rows: [...byUser.values()]
          .map((u) => {
            const weeklyMinutes = aggregateWeeklyMinutes(u.records, weekStart);
            return {
              name: u.name,
              department: u.department,
              weeklyMinutes,
              level: overtimeLevel(weeklyMinutes),
            };
          })
          .filter((u) => u.weeklyMinutes > 0)
          .sort((a, b) => b.weeklyMinutes - a.weeklyMinutes)
          .slice(0, 50),
      };
    },

    async listGroups() {
      return getGroups();
    },

    // ── 본인 조회형 — userId는 executeTool이 주입한 actor(세션)에서만 온다 ──
    async getMyLeaveStatus(userId) {
      const [me] = await db
        .select({ annualLeaveDays: users.annualLeaveDays })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!me) throw new Error("사용자 정보를 찾을 수 없습니다");
      const recent = await db
        .select({
          type: leaveRequests.type,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          days: leaveRequests.days,
          status: leaveRequests.status,
        })
        .from(leaveRequests)
        .where(eq(leaveRequests.userId, userId))
        .orderBy(desc(leaveRequests.createdAt))
        .limit(5);
      return {
        remainingDays: Number(me.annualLeaveDays),
        recentRequests: recent.map((r) => ({
          type: r.type,
          startDate: r.startDate,
          endDate: r.endDate,
          days: Number(r.days),
          status: r.status,
        })),
      };
    },

    async getMyWeekAttendance(userId) {
      const weekStart = weekStartKst(new Date());
      const weekEnd = addDaysToDateStr(weekStart, 7);
      const rows = await db
        .select({
          date: attendanceRecords.date,
          checkInAt: attendanceRecords.checkInAt,
          checkOutAt: attendanceRecords.checkOutAt,
          workedMinutes: attendanceRecords.workedMinutes,
        })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.userId, userId),
            gte(attendanceRecords.date, weekStart),
            lt(attendanceRecords.date, weekEnd),
          ),
        )
        .orderBy(attendanceRecords.date);
      const weeklyMinutes = aggregateWeeklyMinutes(rows, weekStart);
      return {
        weekStart,
        days: rows.map((r) => ({
          date: r.date,
          checkInAt: r.checkInAt.toISOString(),
          checkOutAt: r.checkOutAt?.toISOString() ?? null,
          workedMinutes: r.workedMinutes,
        })),
        weeklyMinutes,
        remainingMinutesTo52h: Math.max(0, WEEKLY_OVER_MINUTES - weeklyMinutes),
        level: overtimeLevel(weeklyMinutes),
      };
    },

    async getMyProposals(userId) {
      const [recent, myTurnCount] = await Promise.all([
        db
          .select({
            title: proposals.title,
            templateKey: proposals.templateKey,
            status: proposals.status,
            createdAt: proposals.createdAt,
          })
          .from(proposals)
          .where(eq(proposals.authorId, userId))
          .orderBy(desc(proposals.createdAt))
          .limit(5),
        countMyTurnProposals(userId),
      ]);
      return {
        recent: recent.map((p) => ({
          title: p.title,
          templateKey: p.templateKey,
          status: p.status,
          createdAt: p.createdAt.toISOString(),
        })),
        myTurnCount,
      };
    },

    // ── 변경형 — executeTool의 승인 게이트 통과 후에만 호출된다 ──────────
    async createUser(input) {
      const domain = await getDefaultDomain();
      const tempPassword = generateTempPassword(randomBytes);
      const created = await graphCreateUser({
        displayName: input.displayName,
        mailNickname: input.mailNickname,
        userPrincipalName: `${input.mailNickname}@${domain}`,
        department: input.department ?? "",
        jobTitle: input.jobTitle ?? "",
        tempPassword,
      });
      // 계정 생성 이후 단계는 부분 실패를 허용한다 — 여기서 throw하면 이미 생성된
      // 계정의 임시 비밀번호가 유실된다 (lifecycle 온보딩의 "비밀번호는 반드시
      // 전달" 원칙과 동일)
      const assignedSkuIds: string[] = [];
      let licenseError: string | undefined;
      if (input.skuIds?.length) {
        try {
          await setUserLicenses(created.id, input.skuIds, []);
          assignedSkuIds.push(...input.skuIds);
        } catch (e) {
          licenseError = e instanceof Error ? e.message : String(e);
        }
      }
      const addedGroups: { id: string; ok: boolean; error?: string }[] = [];
      for (const groupId of input.groupIds ?? []) {
        try {
          await addUserToGroup(created.id, groupId);
          addedGroups.push({ id: groupId, ok: true });
        } catch (e) {
          addedGroups.push({
            id: groupId,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      bustGraphCache("graph:");
      return {
        id: created.id,
        userPrincipalName: created.userPrincipalName,
        tempPassword,
        assignedSkuIds,
        addedGroups,
        licenseError,
      };
    },

    async blockUser(userId) {
      await setAccountEnabled(userId, false);
      bustGraphCache("graph:");
    },

    async revokeUserSessions(userId) {
      await revokeSignInSessions(userId);
    },

    async removeUserLicense(userId, skuId) {
      await setUserLicenses(userId, [], [skuId]);
      bustGraphCache("graph:");
    },

    async removeUserFromGroup(userId, groupId) {
      await removeUserFromGroup(userId, groupId);
      bustGraphCache("graph:");
    },
  };
}
