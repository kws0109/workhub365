import Link from "next/link";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { leaveRequests, users } from "@/db/schema";
import { requireSession } from "@/lib/auth-helpers";
import { kstDateOf } from "@/lib/attendance";
import { GraphError } from "@/lib/graph/client";
import { getDelegatedGraphToken } from "@/lib/graph/delegated";
import { getDirectoryUsers, type DirectoryUser } from "@/lib/graph/users";
import { getPresences } from "@/lib/graph/presence";
import {
  Avatar,
  Badge,
  Card,
  PageHeader,
  SourceChip,
  type Presence,
} from "@/components/ui";

export const metadata = { title: "조직도" };

// 조직도(B3, R8.3) — app-only 디렉터리 실데이터 + 오늘 승인 휴가 배지(자체 DB 조인).
// 프레즌스는 위임 Presence.Read.All — 미동의·실패 시 회색(offline) 강등.

const LEAVE_LABEL = { annual: "휴가", half: "반차", sick: "병가" } as const;
const NO_DEPT = "부서 미지정";

type Person = DirectoryUser & { dept: string };

function deptHref(dept: string, q: string): string {
  const params = new URLSearchParams({ dept });
  if (q) params.set("q", q);
  return `/org?${params.toString()}`;
}

export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; q?: string }>;
}) {
  const session = await requireSession();
  const { dept: deptParam, q: qParam } = await searchParams;
  const q = (qParam ?? "").trim().slice(0, 50);
  const today = kstDateOf(new Date());

  // 스테이지 1 — 디렉터리(app-only, 60초 캐시)·내 정보·오늘 휴가·매니저를 병렬로
  const [directoryResult, me, todayLeaves, managers] = await Promise.all([
    getDirectoryUsers().then(
      (items) => ({ ok: true as const, items }),
      (e: unknown) => ({
        ok: false as const,
        error: e instanceof GraphError ? `${e.code}: ${e.message}` : "알 수 없는 오류",
      }),
    ),
    db.query.users.findFirst({ where: eq(users.id, session.user.id) }),
    db
      .select({
        type: leaveRequests.type,
        entraId: users.entraId,
        email: users.email,
      })
      .from(leaveRequests)
      .innerJoin(users, eq(leaveRequests.userId, users.id))
      .where(
        and(
          eq(leaveRequests.status, "approved"),
          lte(leaveRequests.startDate, today),
          gte(leaveRequests.endDate, today),
        ),
      ),
    db.query.users.findMany({
      where: inArray(users.role, ["manager", "admin"]),
      columns: { name: true, department: true, role: true },
    }),
  ]);

  if (!directoryResult.ok) {
    return (
      <div className="max-w-[1140px]">
        <PageHeader title="조직도" />
        <Card className="mt-6 border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p className="font-semibold">디렉터리 조회에 실패했습니다</p>
          <p className="mt-1">{directoryResult.error}</p>
        </Card>
      </div>
    );
  }

  // 비활성 계정은 조직도에서 제외 (오프보딩 중간 상태 포함)
  const people: Person[] = directoryResult.items
    .filter((u) => u.accountEnabled)
    .map((u) => ({ ...u, dept: u.department?.trim() || NO_DEPT }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));

  // 부서 트리 (인원 내림차순, 미지정은 맨 뒤)
  const deptCounts = new Map<string, number>();
  for (const p of people) {
    deptCounts.set(p.dept, (deptCounts.get(p.dept) ?? 0) + 1);
  }
  const depts = [...deptCounts.entries()].sort((a, b) =>
    a[0] === NO_DEPT ? 1 : b[0] === NO_DEPT ? -1 : b[1] - a[1],
  );

  const selectedDept =
    deptParam && deptCounts.has(deptParam)
      ? deptParam
      : me?.department && deptCounts.has(me.department)
        ? me.department
        : (depts[0]?.[0] ?? NO_DEPT);

  // 오늘 승인 휴가 배지 — DB 사용자와 디렉터리는 entraId(oid) 우선, 이메일=UPN 예비로 매칭
  const leaveByKey = new Map<string, string>();
  for (const l of todayLeaves) {
    const label = LEAVE_LABEL[l.type];
    if (l.entraId) leaveByKey.set(l.entraId, label);
    leaveByKey.set(l.email.toLowerCase(), label);
  }
  const leaveOf = (p: Person) =>
    leaveByKey.get(p.id) ?? leaveByKey.get(p.userPrincipalName.toLowerCase());

  // 부서 매니저 이름 (manager 우선, 없으면 admin)
  const managerOf = (dept: string) =>
    managers.find((m) => m.department === dept && m.role === "manager")?.name ??
    managers.find((m) => m.department === dept && m.role === "admin")?.name;

  const searching = q.length > 0;
  const lowered = q.toLowerCase();
  const shown = searching
    ? people.filter((p) =>
        [p.displayName, p.dept, p.jobTitle ?? ""].some((f) =>
          f.toLowerCase().includes(lowered),
        ),
      )
    : people.filter((p) => p.dept === selectedDept);

  // 스테이지 2 — 표시 인원의 프레즌스(위임). 토큰 없음·403이면 null → 회색 강등
  const token = await getDelegatedGraphToken();
  const presences = token
    ? await getPresences(token, shown.map((p) => p.id)).catch(() => null)
    : null;

  const presenceOf = (p: Person): Presence =>
    presences?.get(p.id) ?? "offline";

  return (
    <div className="max-w-[1140px]">
      <PageHeader
        title="조직도"
        subtitle={<SourceChip brand="graph">Entra ID 디렉터리</SourceChip>}
        actions={
          <form action="/org" className="flex">
            {!searching && <input type="hidden" name="dept" value={selectedDept} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="이름, 부서, 직무 검색"
              className="w-64 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none placeholder:text-ink-muted focus:border-line-strong"
            />
          </form>
        }
      />

      <div className="mt-5 grid grid-cols-[240px_minmax(0,1fr)] items-start gap-4">
        {/* 부서 트리 */}
        <Card className="p-3">
          <div className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] font-semibold">
            전체
            <span className="text-[11px] font-medium text-ink-muted">
              {people.length}
            </span>
          </div>
          <div className="ml-2.5 flex flex-col gap-px border-l border-fill pl-1.5">
            {depts.map(([dept, count]) => {
              const active = !searching && dept === selectedDept;
              return (
                <Link
                  key={dept}
                  href={deptHref(dept, "")}
                  className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] transition ${
                    active
                      ? "bg-fill font-semibold"
                      : "text-ink-sub hover:bg-canvas"
                  }`}
                >
                  {dept}
                  <span className="text-[11px] text-ink-muted">{count}</span>
                </Link>
              );
            })}
          </div>
          <p className="mt-3 border-t border-fill px-2.5 pt-3 text-[11px] leading-relaxed text-ink-muted">
            부서·직급·프로필은 Entra ID 디렉터리 기준 · 상태는 Teams 프레즌스
            {!presences && " (재로그인 동의 전 — 회색 표시)"}
          </p>
        </Card>

        {/* 인물 카드 그리드 */}
        <div className="min-w-0">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-base font-semibold">
              {searching ? "검색 결과" : selectedDept}
            </h2>
            <span className="text-[13px] text-ink-secondary">
              {shown.length}명
              {!searching &&
                managerOf(selectedDept) &&
                ` · 팀장 ${managerOf(selectedDept)}`}
            </span>
          </div>
          {shown.length === 0 ? (
            <Card className="mt-3 p-6 text-sm text-ink-muted">
              {searching ? "검색 결과가 없습니다" : "구성원이 없습니다"}
            </Card>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {shown.map((p) => {
                const leave = leaveOf(p);
                const isMe =
                  (me?.entraId != null && me.entraId === p.id) ||
                  me?.email.toLowerCase() === p.userPrincipalName.toLowerCase();
                return (
                  <Card
                    key={p.id}
                    className="flex min-w-0 items-center gap-3 p-4 transition hover:border-ink-muted"
                  >
                    <Avatar name={p.displayName} size="lg" presence={presenceOf(p)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {p.displayName}
                        {isMe && (
                          <span className="ml-1.5 rounded-full bg-ink px-1.5 py-px align-[1px] text-[10px] font-semibold text-white">
                            나
                          </span>
                        )}
                        {leave && (
                          <Badge tone="warn" className="ml-1.5 align-[1px]">
                            {leave}
                          </Badge>
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-secondary">
                        {p.jobTitle ?? "—"}
                      </p>
                      <p className="mt-px truncate text-[11px] text-ink-muted">
                        {p.userPrincipalName}
                      </p>
                    </div>
                    {/* 퀵액션 — 전부 딥링크 위임 (쓰기 스코프 없음) */}
                    <div className="flex shrink-0 gap-1.5">
                      <QuickAction
                        title="메일 보내기"
                        href={`https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(p.userPrincipalName)}`}
                      >
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-10 6L2 7" />
                      </QuickAction>
                      <QuickAction
                        title="Teams 채팅"
                        href={`https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(p.userPrincipalName)}`}
                      >
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </QuickAction>
                      <QuickAction
                        title="회의 잡기"
                        href={`https://outlook.office.com/calendar/action/compose?to=${encodeURIComponent(p.userPrincipalName)}`}
                      >
                        <rect x="3" y="5" width="18" height="16" rx="2" />
                        <path d="M8 3v4M16 3v4M3 10h18" />
                      </QuickAction>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-line text-ink-secondary transition hover:border-ink-muted hover:text-ink"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[13px] w-[13px]"
        aria-hidden
      >
        {children}
      </svg>
    </a>
  );
}
