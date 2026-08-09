import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "admin" | "manager" | "employee";
      /** 인사 정정 권한 (role과 직교) — 판정은 lib/hr.ts의 isHrEditor로만 한다 */
      hrAdmin: boolean;
    } & DefaultSession["user"];
  }

  interface Profile {
    oid?: string;
    tid?: string;
    preferred_username?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    oid?: string;
    dbId?: string;
    role?: "admin" | "manager" | "employee";
    /** 인사 정정 권한 — role과 같은 주기로 갱신된다 (undefined면 fail-closed) */
    hrAdmin?: boolean;
    /** 역할/삭제 확인을 마지막으로 수행한 시각 (epoch ms) — 60초 스로틀용 */
    roleCheckedAt?: number;
    /** 위임 Graph 액세스 토큰 — 서버 전용(lib/graph/delegated.ts)으로만 읽는다.
     *  session 콜백에 싣지 않는다 (/api/auth/session으로 브라우저 노출 금지) */
    graphAccessToken?: string;
    /** graphAccessToken 만료 시각 (epoch ms) */
    graphExpiresAt?: number;
    graphRefreshToken?: string;
  }
}
