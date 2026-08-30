import { describe, expect, it, vi } from "vitest";

import {
  FacilityIdentifierExhaustedError,
  OUTBOX_TOPIC_AUTHORITY,
  OUTBOX_WORKER_TOPICS,
  allocateFacilityIdentifiers,
  authenticateOutboxWorker,
  canonicalJsonHash,
  executeIdempotentCommand,
  idempotentCommandRequestHash,
  reauthorizeActorForCommand,
  staleConflict,
} from "@/lib/command-foundation";

describe("command foundation", () => {
  it("hashes semantically identical object payloads consistently", () => {
    expect(canonicalJsonHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJsonHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(canonicalJsonHash({ values: [2, 1] })).not.toBe(canonicalJsonHash({ values: [1, 2] }));
  });

  it("preserves the durable pre-M14 hash for callers without an authorization scope override", () => {
    const legacyFixture = {
      commandType: "animal.update",
      labId: "lab-microglia",
      workflowDraftId: null,
      aggregateType: "animal",
      aggregateId: "animal-001",
      expectedVersion: 4,
      requiredCapability: "animals:manage" as const,
      request: { animalId: "animal-001", status: "active" },
    };
    expect(idempotentCommandRequestHash(legacyFixture)).toBe(
      "19b8e7061f733548ae079b559ae0db833ead9416bae0ea8326b3a93db0dbc505",
    );
  });

  it("hashes an explicit null authorization scope without changing the legacy default", () => {
    const fixture = {
      commandType: "animal.update",
      labId: "lab-microglia",
      workflowDraftId: null,
      aggregateType: "animal",
      aggregateId: "animal-001",
      expectedVersion: 4,
      requiredCapability: "animals:manage" as const,
      request: { animalId: "animal-001", status: "active" },
    };
    expect(idempotentCommandRequestHash({ ...fixture, authorizationLabId: null })).toBe(
      "b1c4e6286fb56aa92cf2a51d8319d06aff1d3ac1b8b1a3d59916fac1b79b0ecc",
    );
    expect(idempotentCommandRequestHash({ ...fixture, authorizationLabId: null })).not.toBe(
      idempotentCommandRequestHash(fixture),
    );
  });

  it("returns a structured stale-conflict response", () => {
    expect(staleConflict("animal", "animal-1", 4, 6)).toMatchObject({
      ok: false,
      code: "stale_conflict",
      aggregateType: "animal",
      aggregateId: "animal-1",
      expectedVersion: 4,
      currentVersion: 6,
    });
  });

  it("allocates fixed-width facility identifiers returned by the reservation query", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        { sequence_value: BigInt(8), width: 4 },
        { sequence_value: BigInt(9), width: 4 },
        { sequence_value: BigInt(11), width: 4 },
      ]),
    };
    await expect(allocateFacilityIdentifiers(tx as never, "animal", 3)).resolves.toEqual(["0008", "0009", "0011"]);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
  });

  it("fails with a domain error when the sequence is exhausted", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
    await expect(allocateFacilityIdentifiers(tx as never, "cage", 1)).rejects.toEqual(
      expect.objectContaining({
        name: "FacilityIdentifierExhaustedError",
        code: "facility_identifier_exhausted",
        entityType: "cage",
      } satisfies Partial<FacilityIdentifierExhaustedError>),
    );
  });

  it("requires explicit topic-specific authority", () => {
    expect(OUTBOX_TOPIC_AUTHORITY).toEqual({
      "notifications.in_app": "notifications:deliver",
      "notifications.email": "notifications:deliver",
      "notifications.digest": "notifications:deliver",
      "billing.invoice": "billing:generate",
      "sop.assignment": "sops:manage",
      "audit.security": "audit:security",
      "workflow.command": "approvals:read",
    });
    expect(OUTBOX_WORKER_TOPICS.billing_delivery).toEqual(["billing.invoice"]);
  });

  it("authenticates a worker only with its topic-specific secret", () => {
    vi.stubEnv("OUTBOX_WORKER_TOKEN_BILLING_DELIVERY", "billing-worker-secret-token-at-least-32-characters");
    expect(authenticateOutboxWorker({
      workerId: "billing-worker-1",
      workerType: "billing_delivery",
      token: "billing-worker-secret-token-at-least-32-characters",
    })).toMatchObject({ id: "billing-worker-1", type: "billing_delivery" });
    expect(authenticateOutboxWorker({
      workerId: "billing-worker-1",
      workerType: "billing_delivery",
      token: "wrong-worker-secret-token-at-least-32-character",
    })).toBeNull();
    expect(() => authenticateOutboxWorker({
      workerId: "billing-worker-1",
      workerType: "billing_delivery",
      token: "é".repeat("billing-worker-secret-token-at-least-32-characters".length),
    })).not.toThrow();
    vi.unstubAllEnvs();
  });

  it("fails closed when stale-write protection names an unknown aggregate", async () => {
    const result = await executeIdempotentCommand({
      actor: {} as never,
      commandType: "verification.invalid-aggregate",
      idempotencyKey: "invalid-aggregate",
      requestId: "request-invalid-aggregate",
      request: {},
      requiredCapability: "animals:manage",
      aggregateType: "animla",
      aggregateId: "animal-1",
      expectedVersion: 1,
      handler: async () => ({ ok: true as const, result: {} }),
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_aggregate_type",
      message: "Expected-version commands require a supported aggregate type and aggregate ID.",
    });
  });

  it("fails closed when expected-version protection omits the aggregate ID", async () => {
    const result = await executeIdempotentCommand({
      actor: {} as never,
      commandType: "verification.missing-aggregate-id",
      idempotencyKey: "missing-aggregate-id",
      requestId: "request-missing-aggregate-id",
      request: {},
      requiredCapability: "animals:manage",
      aggregateType: "animal",
      expectedVersion: 1,
      handler: async () => ({ ok: true as const, result: {} }),
    });

    expect(result).toMatchObject({ ok: false, code: "invalid_aggregate_type" });
  });

  it("re-reads duty authority at command time and does not grant lab visibility", async () => {
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue({ active: true, authzVersion: 7, role: "lab_user", labMemberships: [] }) },
      $queryRaw: vi.fn().mockResolvedValue([{ duty: "billing_administrator" }]),
    };
    const actor = { id: "duty-user", authzVersion: 7, activeLabId: null };

    await expect(reauthorizeActorForCommand(tx as never, actor, "billing:govern", null)).resolves.toBe(true);
    await expect(reauthorizeActorForCommand(tx as never, actor, "billing:govern", "lab-private")).resolves.toBe(false);
    await expect(reauthorizeActorForCommand(tx as never, actor, "billing:manage", null)).resolves.toBe(false);

    tx.$queryRaw.mockResolvedValue([]);
    await expect(reauthorizeActorForCommand(tx as never, actor, "billing:govern", null)).resolves.toBe(false);
  });

  it("fails command and outbox-style reauthorization after version invalidation", async () => {
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue({ active: true, authzVersion: 8, role: "lab_user", labMemberships: [] }) },
      $queryRaw: vi.fn().mockResolvedValue([{ duty: "billing_administrator" }]),
    };
    await expect(reauthorizeActorForCommand(
      tx as never,
      { id: "duty-user", authzVersion: 7, activeLabId: null },
      "billing:govern",
      null,
    )).resolves.toBe(false);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
