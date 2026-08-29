import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { recordSecurityEventBestEffort, securityEventTimeBucket } from "@/lib/security-event";
import { resolveCredentialAuthenticationContext } from "@/lib/identity-assurance";
import type { AuthenticationMethod } from "@/lib/identity-assurance";
import type { IdentityAssuranceLevel } from "@/lib/types";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
const authSecret = process.env.AUTH_SECRET;

function authEventKey(kind: "unknown" | "inactive" | "denied" | "succeeded", subject: string) {
  return `auth:${kind}:${subject}:${securityEventTimeBucket()}`;
}

if (!authSecret) {
  throw new Error("AUTH_SECRET is required.");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: authSecret,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);

        if (!parsed.success) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            active: true,
            authzVersion: true,
            passwordHash: true,
          },
        });

        if (!user) {
          const dedupeKey = authEventKey("unknown", "credentials");
          await recordSecurityEventBestEffort({
            eventType: "authentication.sign_in.denied",
            outcome: "denied",
            severity: "warning",
            correlationId: dedupeKey,
            dedupeKey,
            subjectType: "authentication_surface",
            subjectId: "credentials",
            source: "credentials_provider",
            summary: "Credentials sign-in denied.",
          });
          return null;
        }

        if (!user.active) {
          const dedupeKey = authEventKey("inactive", user.id);
          await recordSecurityEventBestEffort({
            eventType: "authentication.sign_in.denied",
            outcome: "denied",
            severity: "warning",
            actorId: user.id,
            correlationId: dedupeKey,
            dedupeKey,
            subjectType: "user",
            subjectId: user.id,
            source: "credentials_provider",
            summary: "Credentials sign-in denied.",
          });
          return null;
        }

        if (!verifyPassword(parsed.data.password, user.passwordHash)) {
          const dedupeKey = authEventKey("denied", user.id);
          await recordSecurityEventBestEffort({
            eventType: "authentication.sign_in.denied",
            outcome: "denied",
            severity: "warning",
            actorId: user.id,
            correlationId: dedupeKey,
            dedupeKey,
            subjectType: "user",
            subjectId: user.id,
            source: "credentials_provider",
            summary: "Credentials sign-in denied.",
          });
          return null;
        }

        const dedupeKey = authEventKey("succeeded", user.id);
        await recordSecurityEventBestEffort({
          eventType: "authentication.sign_in.succeeded",
          outcome: "succeeded",
          actorId: user.id,
          correlationId: dedupeKey,
          dedupeKey,
          subjectType: "user",
          subjectId: user.id,
          source: "credentials_provider",
          summary: "Credentials sign-in succeeded.",
        });

        const authentication = await resolveCredentialAuthenticationContext(user.id, user.email);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          authzVersion: user.authzVersion,
          authMethod: authentication.authenticationMethod,
          assurance: authentication.assurance,
          authenticatedAt: authentication.authenticatedAt,
          identityLinkId: authentication.identityLinkId,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.authzVersion = user.authzVersion;
        token.authMethod = user.authMethod;
        token.assurance = user.assurance;
        token.authenticatedAt = user.authenticatedAt;
        token.identityLinkId = user.identityLinkId;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = (token.role as typeof session.user.role) ?? "lab_user";
        session.user.authzVersion = Number(token.authzVersion ?? 0);
        session.user.authMethod = (token.authMethod as AuthenticationMethod | undefined) ?? "password";
        session.user.assurance = (token.assurance as IdentityAssuranceLevel | undefined) ?? "password";
        session.user.authenticatedAt = typeof token.authenticatedAt === "string" ? token.authenticatedAt : "";
        session.user.identityLinkId = typeof token.identityLinkId === "string" ? token.identityLinkId : null;
      }

      return session;
    },
  },
});
