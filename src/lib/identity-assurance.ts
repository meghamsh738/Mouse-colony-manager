import type { ExternalIdentityProvider, Prisma } from "@prisma/client";

import { EMPTY_PROFILES } from "@/lib/empty-profile-config";
import { prisma } from "@/lib/prisma";
import { SEEDED_ROLE_QA_EMAILS } from "@/lib/seed-metadata";
import type { IdentityAssuranceLevel } from "@/lib/types";

export type DeploymentProfile = "synthetic" | "production";
export type AuthenticationMethod = "password" | "synthetic_mfa" | "oidc" | "saml";

export type AuthenticationContext = {
  authenticationMethod: AuthenticationMethod;
  assurance: IdentityAssuranceLevel;
  authenticatedAt: string;
  identityLinkId: string | null;
};

export type IdentityAssertion = {
  provider: ExternalIdentityProvider;
  subject: string;
  authenticationMethod: AuthenticationMethod;
  assurance: IdentityAssuranceLevel;
  assertedAt: Date;
};

export type VerifiedIdentityAssertion = IdentityAssertion & {
  userId: string;
  identityLinkId: string;
};

export type IdentityAssertionProvider = {
  readonly provider: ExternalIdentityProvider;
  verify(assertion: IdentityAssertion): Promise<IdentityAssertion | null>;
};

const assuranceRank: Record<IdentityAssuranceLevel, number> = {
  password: 0,
  mfa: 1,
  synthetic_mfa: 1,
  phishing_resistant: 2,
};

const syntheticIdentityAllowlist = new Set([
  ...EMPTY_PROFILES.map((profile) => profile.email.toLowerCase()),
  ...Object.values(SEEDED_ROLE_QA_EMAILS).map((email) => email.toLowerCase()),
]);

export function getDeploymentProfile(raw = process.env.MCM_DEPLOYMENT_PROFILE): DeploymentProfile {
  if (raw === undefined || raw === "") return "production";
  if (raw === "synthetic" || raw === "production") return raw;
  throw new Error("MCM_DEPLOYMENT_PROFILE must be synthetic or production.");
}

export function isGuardedSyntheticTarget(input: {
  databaseUrl?: string;
  identity: string;
  profile?: DeploymentProfile;
}) {
  if ((input.profile ?? getDeploymentProfile()) !== "synthetic") return false;
  if (!syntheticIdentityAllowlist.has(input.identity.trim().toLowerCase())) return false;

  try {
    const url = new URL(input.databaseUrl ?? process.env.DATABASE_URL ?? "");
    const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
    const databaseName = url.pathname.replace(/^\//, "");
    const schemaName = url.searchParams.get("schema") ?? "";
    return loopback && [databaseName, schemaName].some((target) => /^mcm_test_[a-z0-9_-]+$/i.test(target));
  } catch {
    return false;
  }
}

export function credentialAuthenticationContext(email: string, now = new Date()) {
  if (isGuardedSyntheticTarget({ identity: email })) {
    return {
      authenticationMethod: "synthetic_mfa" as const,
      assurance: "synthetic_mfa" as const,
      authenticatedAt: now.toISOString(),
      identityLinkId: null,
    };
  }
  return {
    authenticationMethod: "password" as const,
    assurance: "password" as const,
    authenticatedAt: now.toISOString(),
    identityLinkId: null,
  };
}

export async function resolveCredentialAuthenticationContext(userId: string, email: string, now = new Date()) {
  const candidate = credentialAuthenticationContext(email, now);
  if (candidate.assurance !== "synthetic_mfa") return candidate;
  const link = await prisma.externalIdentityLink.findUnique({
    where: { provider_providerSubject: { provider: "synthetic", providerSubject: email.trim().toLowerCase() } },
    select: { id: true, userId: true, active: true, revokedAt: true, assurance: true },
  });
  if (!link || link.userId !== userId || !link.active || link.revokedAt || link.assurance !== "synthetic_mfa") {
    return {
      authenticationMethod: "password" as const,
      assurance: "password" as const,
      authenticatedAt: now.toISOString(),
      identityLinkId: null,
    };
  }
  return { ...candidate, identityLinkId: link.id };
}

export function isElevatedAssurance(assurance?: IdentityAssuranceLevel | null) {
  return Boolean(assurance && assuranceRank[assurance] >= assuranceRank.mfa);
}

export async function isElevatedIdentityContextCurrent(
  database: Pick<Prisma.TransactionClient, "externalIdentityLink">,
  context: {
    userId: string;
    identity: string;
    identityLinkId?: string | null;
    authenticationMethod?: AuthenticationMethod | null;
    assurance?: IdentityAssuranceLevel | null;
    authenticatedAt?: string | Date | null;
  },
  input: { now?: Date; maxAgeMinutes?: number } = {},
) {
  if (!context.identityLinkId || !hasFreshMfaAssurance(context, input)) return false;
  const link = await database.externalIdentityLink.findUnique({
    where: { id: context.identityLinkId },
    select: { userId: true, provider: true, assurance: true, active: true, revokedAt: true },
  });
  if (!link
    || link.userId !== context.userId
    || !link.active
    || link.revokedAt
    || link.assurance !== context.assurance) return false;
  const expectedMethod = link.provider === "synthetic" ? "synthetic_mfa" : link.provider;
  return context.authenticationMethod === expectedMethod;
}

export function hasFreshMfaAssurance(
  context: {
    identity?: string | null;
    authenticationMethod?: AuthenticationMethod | null;
    assurance?: IdentityAssuranceLevel | null;
    authenticatedAt?: string | Date | null;
  },
  input: { now?: Date; maxAgeMinutes?: number } = {},
) {
  if (!context.assurance || assuranceRank[context.assurance] < assuranceRank.mfa || !context.authenticatedAt) return false;
  const now = input.now ?? new Date();
  const authenticatedAt = context.authenticatedAt instanceof Date
    ? context.authenticatedAt
    : new Date(context.authenticatedAt);
  if (Number.isNaN(authenticatedAt.getTime())) return false;
  const ageMs = now.getTime() - authenticatedAt.getTime();
  if (ageMs < -60_000 || ageMs > (input.maxAgeMinutes ?? 10) * 60_000) return false;
  if (context.assurance === "synthetic_mfa") {
    return context.authenticationMethod === "synthetic_mfa"
      && Boolean(context.identity)
      && isGuardedSyntheticTarget({ identity: context.identity ?? "" });
  }
  return context.authenticationMethod === "oidc" || context.authenticationMethod === "saml";
}

export function createIdentityAssertionResolver(providers: readonly IdentityAssertionProvider[]) {
  const registry = new Map(providers.map((provider) => [provider.provider, provider]));

  return async function resolve(assertion: IdentityAssertion): Promise<VerifiedIdentityAssertion | null> {
    if (getDeploymentProfile() === "production" && assertion.provider === "synthetic") return null;
    const expectedMethod = assertion.provider === "synthetic" ? "synthetic_mfa" : assertion.provider;
    if (assertion.authenticationMethod !== expectedMethod) return null;
    if (assertion.provider === "synthetic"
      && (assertion.assurance !== "synthetic_mfa"
        || !isGuardedSyntheticTarget({ identity: assertion.subject }))) return null;
    if (assertion.provider !== "synthetic" && assertion.assurance === "synthetic_mfa") return null;
    const provider = registry.get(assertion.provider);
    if (!provider || !assertion.subject.trim()) return null;
    const verified = await provider.verify(assertion).catch(() => null);
    if (!verified
      || verified.provider !== assertion.provider
      || verified.subject !== assertion.subject
      || verified.authenticationMethod !== assertion.authenticationMethod
      || verified.assurance !== assertion.assurance
      || verified.assertedAt.getTime() !== assertion.assertedAt.getTime()) return null;

    const link = await prisma.externalIdentityLink.findUnique({
      where: { provider_providerSubject: { provider: verified.provider, providerSubject: verified.subject } },
      select: { id: true, userId: true, active: true, assurance: true, revokedAt: true, user: { select: { active: true } } },
    });
    if (!link?.active || link.revokedAt || !link.user.active) return null;
    if (assuranceRank[verified.assurance] < assuranceRank[link.assurance]) return null;

    return { ...verified, userId: link.userId, identityLinkId: link.id };
  };
}

// External providers are intentionally absent until a deployment supplies a
// reviewed adapter. Unknown OIDC/SAML assertions therefore fail closed.
export const resolveExternalIdentityAssertion = createIdentityAssertionResolver([]);
