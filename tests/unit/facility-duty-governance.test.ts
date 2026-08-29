import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decideFacilityDutyRequest,
  requestFacilityDutyGrant,
} from "@/lib/facility-duty-governance";

const now = new Date();

function actor(overrides: Record<string, unknown> = {}) {
  return {
    id: "admin-1",
    email: "qa-facility-admin@colony.local",
    canonicalRole: "facility_admin" as const,
    authzVersion: 1,
    authMethod: "synthetic_mfa" as const,
    assurance: "synthetic_mfa" as const,
    authenticatedAt: now.toISOString(),
    identityLinkId: "identity-link-admin-1",
    ...overrides,
  };
}

describe("facility duty governance input boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires current MFA-level assurance before any high-risk write", async () => {
    await expect(requestFacilityDutyGrant({
      targetUserId: "user-2",
      duty: "designated_veterinarian",
      validFrom: now,
      validUntil: new Date(now.getTime() + 60_000),
      reason: "Required coverage",
    }, actor({ authMethod: "password", assurance: "password" }))).resolves.toEqual({
      ok: false,
      message: "Fresh MFA-level assurance is required for facility duty governance.",
    });
  });

  it("rejects validity outside 1 minute to 366 days before touching the database", async () => {
    vi.stubEnv("MCM_DEPLOYMENT_PROFILE", "synthetic");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/mcm_test_m12?schema=mcm_test_m12");
    await expect(requestFacilityDutyGrant({
      targetUserId: "user-2",
      duty: "welfare_officer",
      validFrom: now,
      validUntil: new Date(now.getTime() + 59_999),
      reason: "Required coverage",
    }, actor())).resolves.toMatchObject({ ok: false, message: expect.stringContaining("1 minute") });
  });

  it("requires a rejection reason before a maker-checker decision", async () => {
    vi.stubEnv("MCM_DEPLOYMENT_PROFILE", "synthetic");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/mcm_test_m12?schema=mcm_test_m12");
    await expect(decideFacilityDutyRequest({
      requestId: "request-1",
      expectedVersion: 1,
      decision: "reject",
      reason: "no",
    }, actor({ id: "admin-2", email: "qa-facility-admin-approver@colony.local" }))).resolves.toEqual({
      ok: false,
      message: "Provide a rejection reason between 5 and 500 characters.",
    });
  });
});
