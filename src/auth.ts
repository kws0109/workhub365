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
  providers: [
    MicrosoftEntraID({
      authorization: {
        params: {
          // 기본 스코프 + 홈 대시보드 M365 위젯(R7.4)용 메일·일정 읽기.
          // offline_access: 리프레시 토큰 발급 — 액세스 토큰(~1시간) 만료 후 위젯 유지
          scope:
            "openid profile email User.Read Mail.Read Calendars.Read offline_access",
        },
      },
    }),
  ],
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
    async jwt({ token, profile, account }) {
      if (typeof profile?.oid === "string") {
        token.oid = profile.oid;
      }
      // 최초 로그인 시 위임 Graph 토큰을 JWT(암호화 쿠키)에 보관 —
      // 읽기는 서버 전용 lib/graph/delegated.ts만, session 콜백에는 싣지 않는다
      if (account?.access_token) {
        token.graphAccessToken = account.access_token;
        token.graphExpiresAt = (account.expires_at ?? 0) * 1000;
        token.graphRefreshToken = account.refresh_token;
      }
      // 역할 갱신·삭제 확인은 60초에 1회만 — 매 요청 DB 왕복(원격 DB ~200ms)을 피한다.
      // 트레이드오프: 승격/강등/삭제 반영이 최대 60초 지연 (기존 매 요청 대비 허용 범위)
      const ROLE_REFRESH_MS = 60_000;
      const checkedAt =
        typeof token.roleCheckedAt === "number" ? token.roleCheckedAt : 0;
      const stale =
        !token.dbId ||
        typeof profile?.oid === "string" ||
        Date.now() - checkedAt > ROLE_REFRESH_MS;
      if (typeof token.oid === "string" && stale) {
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
        token.roleCheckedAt = Date.now();
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
