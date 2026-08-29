import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/lib/types";
import type { IdentityAssuranceLevel } from "@/lib/types";
import type { AuthenticationMethod } from "@/lib/identity-assurance";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      authzVersion: number;
      authMethod: AuthenticationMethod;
      assurance: IdentityAssuranceLevel;
      authenticatedAt: string;
      identityLinkId: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    authzVersion: number;
    authMethod: AuthenticationMethod;
    assurance: IdentityAssuranceLevel;
    authenticatedAt: string;
    identityLinkId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
    authzVersion?: number;
    authMethod?: AuthenticationMethod;
    assurance?: IdentityAssuranceLevel;
    authenticatedAt?: string;
    identityLinkId?: string | null;
  }
}
