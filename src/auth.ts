import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

function isBootstrapAdmin(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

// 허용 테넌트: ISSUER URL의 테넌트 GUID가 1차 소스 (GRAPH_TENANT_ID는 백업).
// 어느 쪽도 없으면 null → 로그인 전면 거부 (provider의 /common 폴백 방어)
function expectedTenantId(): string | null {
  const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
  const fromIssuer = issuer?.match(
    /login\.microsoftonline\.com\/([0-9a-f-]{36})/i,
  )?.[1];
  return (fromIssuer ?? process.env.GRAPH_TENANT_ID)?.toLowerCase() ?? null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [MicrosoftEntraID],
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ profile }) {
      // ISSUER 미설정 시 provider가 멀티테넌트 /common으로 조용히 폴백한다 — fail-closed
      if (!process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER) return false;
      // 토큰의 테넌트(tid)를 코드에서 재검증 — 앱 등록 설정에만 의존하지 않는다
      const expected = expectedTenantId();
      if (!expected || profile?.tid?.toLowerCase() !== expected) {
        return false;
      }

      const rawEmail = profile.email ?? profile.preferred_username;
      const entraId = profile.oid;
      if (typeof rawEmail !== "string" || typeof entraId !== "string") {
        return false;
      }
      const email = rawEmail.toLowerCase();
      const name = typeof profile.name === "string" ? profile.name : email;
      const wantAdmin = isBootstrapAdmin(email);

      // 식별자는 불변 oid(entraId). 이메일은 변경·재활용될 수 있어 매칭 키로 쓰지 않는다
      const byOid = await db.query.users.findFirst({
        where: eq(users.entraId, entraId),
      });
      if (byOid) {
        await db
          .update(users)
          .set({
            email,
            name,
            // ADMIN_EMAILS 승격은 매 로그인마다 평가 (최초 가입 시에만 적용하면 부트스트랩 데드락)
            ...(wantAdmin && byOid.role !== "admin"
              ? { role: "admin" as const }
              : {}),
          })
          .where(eq(users.id, byOid.id));
        return true;
      }

      // 사전 등록 행(entraId 없이 email만 존재)과의 1회 연결
      const byEmail = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (byEmail) {
        // 다른 oid가 이미 연결된 행 = 재활용된 이메일 — 타인 행 탈취 금지
        if (byEmail.entraId && byEmail.entraId !== entraId) return false;
        await db
          .update(users)
          .set({
            entraId,
            name,
            ...(wantAdmin && byEmail.role !== "admin"
              ? { role: "admin" as const }
              : {}),
          })
          .where(eq(users.id, byEmail.id));
        return true;
      }

      // 동시 최초 로그인 경합은 entra_id 충돌 시 update로 흡수 (원자적 upsert)
      await db
        .insert(users)
        .values({
          entraId,
          email,
          name,
          role: wantAdmin ? "admin" : "employee",
        })
        .onConflictDoUpdate({
          target: users.entraId,
          set: { email, name },
        });
      return true;
    },
    async jwt({ token, profile }) {
      if (typeof profile?.oid === "string") {
        token.oid = profile.oid;
      }
      if (typeof token.oid === "string") {
        const row = await db.query.users.findFirst({
          where: eq(users.entraId, token.oid),
        });
        if (row) {
          token.dbId = row.id;
          token.role = row.role;
          token.name = row.name;
        } else {
          // 행이 삭제된 사용자는 fail-closed — 세션에서 신원 제거
          delete token.dbId;
          delete token.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.dbId) {
        session.user.id = token.dbId as string;
        session.user.role = token.role as "admin" | "manager" | "employee";
      }
      return session;
    },
  },
});
