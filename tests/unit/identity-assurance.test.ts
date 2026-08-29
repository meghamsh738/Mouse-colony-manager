import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { externalIdentityLink: { findUnique: mocks.findUnique } } }));

import {
  createIdentityAssertionResolver,
  credentialAuthenticationContext,
  getDeploymentProfile,
  hasFreshMfaAssurance,
  isElevatedIdentityContextCurrent,
  isGuardedSyntheticTarget,
  resolveCredentialAuthenticationContext,
  type IdentityAssertion,
} from "@/lib/identity-assurance";

describe("identity assurance boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("allows a production-mode build configuration to select the guarded synthetic profile", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(getDeploymentProfile("synthetic")).toBe("synthetic");
  });

  it("limits synthetic MFA to allowlisted identities on loopback mcm_test targets", () => {
    vi.stubEnv("MCM_DEPLOYMENT_PROFILE", "synthetic");
    const safeUrl = "postgresql://postgres:postgres@127.0.0.1:5432/mcm_test_m12?schema=mcm_test_m12";
    expect(isGuardedSyntheticTarget({ databaseUrl: safeUrl, identity: "qa-facility-admin@colony.local" })).toBe(true);
    expect(isGuardedSyntheticTarget({ databaseUrl: safeUrl, identity: "unknown@example.test" })).toBe(false);
    expect(isGuardedSyntheticTarget({ databaseUrl: safeUrl.replace("127.0.0.1", "database.example.test"), identity: "qa-facility-admin@colony.local" })).toBe(false);
    expect(isGuardedSyntheticTarget({ databaseUrl: safeUrl.replaceAll("mcm_test_m12", "colony_prod"), identity: "qa-facility-admin@colony.local" })).toBe(false);
  });

  it("fails stale and malformed assurance closed", () => {
    vi.stubEnv("MCM_DEPLOYMENT_PROFILE", "synthetic");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/mcm_test_m12?schema=mcm_test_m12");
    const fresh = credentialAuthenticationContext("qa-facility-admin@colony.local", new Date("2026-08-29T12:00:00Z"));
    expect(hasFreshMfaAssurance({ ...fresh, identity: "qa-facility-admin@colony.local" }, { now: new Date("2026-08-29T12:09:59Z") })).toBe(true);
    expect(hasFreshMfaAssurance({ ...fresh, identity: "qa-facility-admin@colony.local" }, { now: new Date("2026-08-29T12:10:01Z") })).toBe(false);
    expect(hasFreshMfaAssurance({ assurance: "mfa", authenticationMethod: "password", authenticatedAt: fresh.authenticatedAt })).toBe(false);
  });

  it("rejects simulator assertions in production before provider or mapping lookup", async () => {
    vi.stubEnv("MCM_DEPLOYMENT_PROFILE", "production");
    const verify = vi.fn();
    const resolve = createIdentityAssertionResolver([{ provider: "synthetic", verify }]);
    const assertion: IdentityAssertion = {
      provider: "synthetic",
      subject: "qa-facility-admin@colony.local",
      authenticationMethod: "synthetic_mfa",
      assurance: "synthetic_mfa",
      assertedAt: new Date(),
    };
    await expect(resolve(assertion)).resolves.toBeNull();
    expect(verify).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("rejects synthetic assertions outside the guarded target before provider or mapping lookup", async () => {
    vi.stubEnv("MCM_DEPLOYMENT_PROFILE", "synthetic");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@database.example.test:5432/mcm_test_m12?schema=mcm_test_m12");
    const verify = vi.fn();
    const resolve = createIdentityAssertionResolver([{ provider: "synthetic", verify }]);
    const assertion: IdentityAssertion = {
      provider: "synthetic",
      subject: "qa-facility-admin@colony.local",
      authenticationMethod: "synthetic_mfa",
      assurance: "synthetic_mfa",
      assertedAt: new Date(),
    };
    await expect(resolve(assertion)).resolves.toBeNull();
    expect(verify).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("downgrades guarded synthetic credentials unless the exact active mapping exists", async () => {
    vi.stubEnv("MCM_DEPLOYMENT_PROFILE", "synthetic");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/mcm_test_m12?schema=mcm_test_m12");
    mocks.findUnique.mockResolvedValue(null);
    await expect(resolveCredentialAuthenticationContext("user-1", "qa-facility-admin@colony.local")).resolves.toMatchObject({ assurance: "password" });
    mocks.findUnique.mockResolvedValue({ id: "link-1", userId: "user-1", active: true, revokedAt: null, assurance: "synthetic_mfa" });
    await expect(resolveCredentialAuthenticationContext("user-1", "qa-facility-admin@colony.local")).resolves.toMatchObject({ assurance: "synthetic_mfa", identityLinkId: "link-1" });
  });

  it("revalidates elevated assurance against the exact active identity link", async () => {
    vi.stubEnv("MCM_DEPLOYMENT_PROFILE", "synthetic");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/mcm_test_m12?schema=mcm_test_m12");
    const authenticatedAt = new Date();
    mocks.findUnique.mockResolvedValue({
      userId: "user-1",
      provider: "synthetic",
      assurance: "synthetic_mfa",
      active: true,
      revokedAt: null,
    });
    await expect(isElevatedIdentityContextCurrent({ externalIdentityLink: { findUnique: mocks.findUnique } } as never, {
      userId: "user-1",
      identity: "qa-facility-admin@colony.local",
      identityLinkId: "link-1",
      authenticationMethod: "synthetic_mfa",
      assurance: "synthetic_mfa",
      authenticatedAt,
    })).resolves.toBe(true);
    mocks.findUnique.mockResolvedValue({
      userId: "user-1",
      provider: "synthetic",
      assurance: "synthetic_mfa",
      active: false,
      revokedAt: new Date(),
    });
    await expect(isElevatedIdentityContextCurrent({ externalIdentityLink: { findUnique: mocks.findUnique } } as never, {
      userId: "user-1",
      identity: "qa-facility-admin@colony.local",
      identityLinkId: "link-1",
      authenticationMethod: "synthetic_mfa",
      assurance: "synthetic_mfa",
      authenticatedAt,
    })).resolves.toBe(false);
  });

  it("fails closed for unknown providers, bad verification, inactive links, and insufficient assurance", async () => {
    vi.stubEnv("MCM_DEPLOYMENT_PROFILE", "synthetic");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/mcm_test_m12?schema=mcm_test_m12");
    const assertion: IdentityAssertion = {
      provider: "oidc",
      subject: "subject-1",
      authenticationMethod: "oidc",
      assurance: "mfa",
      assertedAt: new Date("2026-08-29T12:00:00Z"),
    };
    await expect(createIdentityAssertionResolver([])(assertion)).resolves.toBeNull();
    await expect(createIdentityAssertionResolver([{ provider: "oidc", verify: async (value) => value }])({
      ...assertion,
      authenticationMethod: "saml",
    })).resolves.toBeNull();
    await expect(createIdentityAssertionResolver([{ provider: "oidc", verify: async () => null }])(assertion)).resolves.toBeNull();

    const resolver = createIdentityAssertionResolver([{ provider: "oidc", verify: async (value) => value }]);
    mocks.findUnique.mockResolvedValue({ id: "link-1", userId: "user-1", active: false, assurance: "mfa", revokedAt: new Date(), user: { active: true } });
    await expect(resolver(assertion)).resolves.toBeNull();
    mocks.findUnique.mockResolvedValue({ id: "link-1", userId: "user-1", active: true, assurance: "phishing_resistant", revokedAt: null, user: { active: true } });
    await expect(resolver(assertion)).resolves.toBeNull();
  });
});
