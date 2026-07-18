import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/lib/types";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      authzVersion: number;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    authzVersion: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
    authzVersion?: number;
  }
}
