import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isHrEditor } from "@/lib/hr";

type Role = "admin" | "manager" | "employee";

// 레이아웃과 페이지가 같은 요청에서 각각 세션을 조회한다(정상적인 이중 방어).
// cache()로 감싸 auth() → jwt 콜백 → DB 조회가 요청당 1회만 실행되게 한다
const getSession = cache(() => auth());

/** 페이지용: 미로그인 시 /login으로 리다이렉트 */
export async function requireSession() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  return session;
}

/** 페이지용: 역할 미달 시 홈으로 리다이렉트 (N2) */
export async function requireRole(...roles: Role[]) {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) redirect("/");
  return session;
}

/** Server Action/Route Handler용: 미로그인 시 throw — 역할 무관 로그인만 요구 (R5.1) */
export async function assertSession() {
  const session = await getSession();
  if (!session?.user?.id) throw new Error("UNAUTHORIZED");
  return session;
}

/** Server Action/Route Handler용: 역할 미달 시 throw — 조용히 통과시키지 않는다 */
export async function assertRole(...roles: Role[]) {
  const session = await assertSession();
  if (!roles.includes(session.user.role)) throw new Error("FORBIDDEN");
  return session;
}

// 인사 정정 권한(hr_admin)은 role과 직교하므로 requireRole/assertRole로 표현할 수 없다.
// UI에서 탭을 감추는 것은 권한이 아니다 — 아래 두 가드가 실행 직전에 재검증한다(2중 게이트).

/** 페이지용: 인사 정정 권한 미달 시 홈으로 리다이렉트 (N2) */
export async function requireHrSession() {
  const session = await requireSession();
  if (!isHrEditor(session.user)) redirect("/");
  return session;
}

/** Server Action용: 인사 정정 권한 미달 시 throw */
export async function assertHr() {
  const session = await assertSession();
  if (!isHrEditor(session.user)) throw new Error("FORBIDDEN");
  return session;
}
