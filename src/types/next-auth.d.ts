import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "admin" | "manager" | "employee";
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
  }
}
