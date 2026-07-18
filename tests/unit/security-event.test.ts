import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  createMany: vi.fn(),
  executeRawUnsafe: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { securityEvent: {
  create: mocks.create,
  createMany: mocks.createMany,
  findUniqueOrThrow: mocks.findUniqueOrThrow,
}, $transaction: mocks.transaction } }));

import {
  recordSecurityEvent,
  recordSecurityEventBestEffort,
  resetSecurityEventCircuitForTests,
} from "@/lib/security-event";

describe("security event writer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSecurityEventCircuitForTests();
    mocks.create.mockResolvedValue({ id: "security-test" });
    mocks.createMany.mockResolvedValue({ count: 1 });
    mocks.executeRawUnsafe.mockResolvedValue(0);
    mocks.findUniqueOrThrow.mockResolvedValue({
      id: "security-deduplicated",
      eventType: "identity.invitation.created",
      outcome: "succeeded",
      severity: "info",
      actorId: null,
      scopeLabId: null,
      correlationId: null,
      subjectType: null,
      subjectId: null,
      source: "identity_governance",
      summary: "User invitation created.",
    });
    mocks.transaction.mockImplementation((callback) => callback({
      $executeRawUnsafe: mocks.executeRawUnsafe,
      securityEvent: { createMany: mocks.createMany },
    }));
  });

  it("coalesces repeated best-effort traffic by its bounded bucket key", async () => {
    const input = {
      eventType: "authorization.api.unauthenticated",
      outcome: "denied" as const,
      severity: "warning" as const,
      correlationId: "api:unauthenticated:animals:read:bucket",
      dedupeKey: "api:unauthenticated:animals:read:bucket",
      subjectType: "capability",
      subjectId: "animals:read",
      source: "api_guard",
      summary: "Unauthenticated API access was denied.",
    };

    await expect(recordSecurityEventBestEffort(input)).resolves.toBe("recorded");
    await expect(recordSecurityEventBestEffort(input)).resolves.toBe("deduplicated");
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.createMany.mock.calls[0]?.[0]).toMatchObject({ skipDuplicates: true });
    expect(mocks.executeRawUnsafe).toHaveBeenCalledWith("SET LOCAL statement_timeout = '200ms'");
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 200, timeout: 1_000 });
  });

  it("times out the caller but admits no work until the underlying attempt settles", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let settleWrite: ((value: { count: number }) => void) | undefined;
    mocks.createMany.mockReturnValueOnce(new Promise((resolve) => {
      settleWrite = resolve;
    }));
    const first = recordSecurityEventBestEffort({
      eventType: "authentication.sign_in.denied",
      outcome: "denied",
      dedupeKey: "auth:unknown:credentials:one",
      source: "credentials_provider",
      summary: "Credentials sign-in denied.",
    });
    await vi.advanceTimersByTimeAsync(251);
    await expect(first).resolves.toBe("failed");
    await expect(recordSecurityEventBestEffort({
      eventType: "authentication.sign_in.denied",
      outcome: "denied",
      dedupeKey: "auth:unknown:credentials:two",
      source: "credentials_provider",
      summary: "Credentials sign-in denied.",
    })).resolves.toBe("circuit_open");
    expect(mocks.createMany).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_001);
    await expect(recordSecurityEventBestEffort({
      eventType: "authentication.sign_in.denied",
      outcome: "denied",
      dedupeKey: "auth:unknown:credentials:three",
      source: "credentials_provider",
      summary: "Credentials sign-in denied.",
    })).resolves.toBe("circuit_open");
    expect(mocks.createMany).toHaveBeenCalledTimes(1);

    settleWrite?.({ count: 1 });
    await vi.runAllTimersAsync();
    await expect(recordSecurityEventBestEffort({
      eventType: "authentication.sign_in.denied",
      outcome: "denied",
      dedupeKey: "auth:unknown:credentials:four",
      source: "credentials_provider",
      summary: "Credentials sign-in denied.",
    })).resolves.toBe("recorded");
    expect(mocks.createMany).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
    vi.useRealTimers();
  });

  it("writes a fixed, metadata-free security record", async () => {
    await recordSecurityEvent({
      eventType: "authentication.sign_in.denied",
      outcome: "denied",
      severity: "warning",
      correlationId: "request-1",
      subjectType: "credential_hash",
      subjectId: "digest",
      source: "credentials_provider",
      summary: "Credentials sign-in denied.",
    });

    const data = mocks.create.mock.calls[0]?.[0]?.data;
    expect(data).toMatchObject({
      eventType: "authentication.sign_in.denied",
      outcome: "denied",
      severity: "warning",
      correlationId: "request-1",
      subjectId: "digest",
    });
    expect(data).not.toHaveProperty("requestId");
    expect(data).not.toHaveProperty("labId");
    expect(data).not.toHaveProperty("metadata");
    expect(data).not.toHaveProperty("details");
  });

  it("makes mandatory transactional events replay-safe when a dedupe key is supplied", async () => {
    await recordSecurityEvent({
      eventType: "identity.invitation.created",
      outcome: "succeeded",
      dedupeKey: "identity.invitation.created:invitation-1",
      source: "identity_governance",
      summary: "User invitation created.",
    });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(mocks.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { dedupeKey: "identity.invitation.created:invitation-1" },
    });
  });

  it("rejects a dedupe collision whose immutable semantics differ", async () => {
    mocks.findUniqueOrThrow.mockResolvedValueOnce({
      id: "security-existing",
      eventType: "identity.invitation.accepted",
      outcome: "succeeded",
      severity: "info",
      actorId: null,
      scopeLabId: null,
      correlationId: null,
      subjectType: null,
      subjectId: null,
      source: "identity_governance",
      summary: "User invitation accepted.",
    });

    await expect(recordSecurityEvent({
      eventType: "identity.invitation.created",
      outcome: "succeeded",
      dedupeKey: "identity.invitation.created:invitation-1",
      source: "identity_governance",
      summary: "User invitation created.",
    })).rejects.toThrow("dedupe key collision has different semantics");
  });

  it("rejects malformed types and partial subject identity", async () => {
    await expect(recordSecurityEvent({
      eventType: "bad type",
      outcome: "failed",
      source: "test",
      summary: "Bad event.",
    })).rejects.toThrow("type is invalid");

    await expect(recordSecurityEvent({
      eventType: "security.test.failed",
      outcome: "failed",
      subjectType: "user",
      source: "test",
      summary: "Bad event.",
    })).rejects.toThrow("both a type and identifier");
  });
});
