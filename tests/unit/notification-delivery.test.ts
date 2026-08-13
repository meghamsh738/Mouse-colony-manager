import { createServer } from "node:http";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildNotificationDeliveryBatch,
  deliverNotificationDigest,
  validateNotificationEmailProviderUrl,
} from "@/lib/notification-delivery";
import {
  authenticateOutboxWorker,
  claimOutboxMessages,
  maintainExpiredOutboxLeases,
} from "@/lib/command-foundation";
import { materializeDashboardNotifications } from "@/lib/notification-materialization";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";
import { seedDatabase } from "../../prisma/seed-database";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
}));

const deliveryActor = {
  id: "user-admin",
  email: "admin@colony.local",
  name: "Facility Admin",
  role: "admin",
  databaseRole: "admin",
  canonicalRole: "facility_admin",
  authzVersion: 1,
  activeLabId: null,
  activeMembership: null,
  memberships: [],
  capabilities: ["notifications:read", "notifications:deliver"],
} as ResolvedActor;

async function materializeUrgentAlert() {
  const suffix = `${Date.now()}-${Math.random()}`;
  await materializeDashboardNotifications({
    alerts: [{
      id: `delivery-alert-${suffix}`,
      labId: "lab-microglia",
      entityType: "cage",
      entityId: "cage-a101-001",
      alertType: "welfare_note",
      severity: "critical",
      message: "Urgent welfare delivery test.",
      status: "open",
      generatedAt: new Date().toISOString(),
      source: "manual",
    }],
    scopeLabIds: ["lab-microglia"],
    includeGlobal: false,
    producerId: deliveryActor.id,
    resolveMissing: false,
  });
}

describe("notification delivery", () => {
  beforeEach(async () => {
    authMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await seedDatabase();
  }, 120_000);

  it("builds a dry-run summary from durable per-recipient jobs", async () => {
    await materializeUrgentAlert();
    const batch = await buildNotificationDeliveryBatch(deliveryActor);

    expect(batch.queuedCount).toBeGreaterThan(0);
    expect(batch.readyCount).toBeGreaterThan(0);
    expect(batch.provider.enabled).toBe(false);
    expect(batch.provider.configured).toBe(false);
  });

  it("rejects unsafe production provider destinations", () => {
    expect(validateNotificationEmailProviderUrl("http://127.0.0.1:8080/send", {
      production: true,
      allowedHosts: ["127.0.0.1"],
    })).toMatchObject({ ok: false });
    expect(validateNotificationEmailProviderUrl("https://[::1]/send", {
      production: true,
      allowedHosts: ["::1"],
    })).toMatchObject({ ok: false });
    expect(validateNotificationEmailProviderUrl("https://169.254.169.254/send", {
      production: true,
      allowedHosts: ["169.254.169.254"],
    })).toMatchObject({ ok: false });
    expect(validateNotificationEmailProviderUrl("https://0.0.0.0/send", {
      production: true,
      allowedHosts: ["0.0.0.0"],
    })).toMatchObject({ ok: false });
    expect(validateNotificationEmailProviderUrl("https://mail.example.test/send", {
      production: true,
      allowedHosts: ["mail.example.test"],
    })).toMatchObject({ ok: true });
    expect(validateNotificationEmailProviderUrl("https://evil.example.test/send", {
      production: true,
      allowedHosts: ["mail.example.test"],
    })).toMatchObject({ ok: false });
  });

  it("keeps delivery disabled until the provider idempotency contract is acknowledged", async () => {
    vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_URL", "http://127.0.0.1:8099/send");
    vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_HOSTS", "127.0.0.1");
    vi.stubEnv("NOTIFICATION_EMAIL_FROM", "mouse-colony@colony.local");
    vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_SUPPORTS_IDEMPOTENCY", "false");
    await prisma.ruleConfig.update({ where: { key: "notify_email_enabled" }, data: { value: true } });

    const batch = await buildNotificationDeliveryBatch(deliveryActor);
    expect(batch.provider).toMatchObject({
      enabled: true,
      configured: false,
      error: expect.stringContaining("SUPPORTS_IDEMPOTENCY=true"),
    });
  });

  it("sweeps an expired final lease even while the email provider is disabled", async () => {
    const token = "disabled-provider-maintenance-token-0123456789";
    vi.stubEnv("OUTBOX_WORKER_TOKEN_NOTIFICATION_DELIVERY", token);
    await materializeUrgentAlert();
    const worker = authenticateOutboxWorker({
      workerId: "disabled-provider-maintenance",
      workerType: "notification_delivery",
      token,
    });
    expect(worker).not.toBeNull();
    if (!worker) return;
    const [claimed] = await claimOutboxMessages({ worker, limit: 1 });
    expect(claimed).toBeDefined();
    if (!claimed) throw new Error("Expected a notification job to be claimed.");
    await prisma.outboxMessage.update({
      where: { id: claimed.id },
      data: { maxAttempts: 1, leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    const result = await deliverNotificationDigest({ dryRun: false, limit: 1 }, deliveryActor);

    expect(result.message).toBe("Email delivery is disabled.");
    await expect(prisma.outboxMessage.findUniqueOrThrow({ where: { id: claimed.id } })).resolves.toMatchObject({
      status: "dead_letter",
      leaseToken: null,
    });
    await expect(prisma.outboxDeliveryAttempt.findUniqueOrThrow({ where: { leaseToken: claimed.leaseToken! } })).resolves.toMatchObject({
      status: "failed",
      completedAt: expect.any(Date),
    });
  });

  it("returns a non-final expired lease to retry and permits a new durable attempt", async () => {
    const token = "expired-retry-maintenance-token-0123456789";
    vi.stubEnv("OUTBOX_WORKER_TOKEN_NOTIFICATION_DELIVERY", token);
    await materializeUrgentAlert();
    const worker = authenticateOutboxWorker({
      workerId: "expired-retry-maintenance",
      workerType: "notification_delivery",
      token,
    });
    expect(worker).not.toBeNull();
    if (!worker) return;
    const [firstClaim] = await claimOutboxMessages({ worker, limit: 1 });
    if (!firstClaim) throw new Error("Expected the first notification claim.");
    await prisma.outboxMessage.update({
      where: { id: firstClaim.id },
      data: { maxAttempts: 3, leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(maintainExpiredOutboxLeases({ worker, limit: 1 })).resolves.toEqual({
      scanned: 1,
      retried: 1,
      deadLettered: 0,
    });
    await expect(prisma.outboxMessage.findUniqueOrThrow({ where: { id: firstClaim.id } })).resolves.toMatchObject({
      status: "retry",
      attemptCount: 1,
      leaseToken: null,
    });
    await expect(prisma.outboxDeliveryAttempt.findUniqueOrThrow({ where: { leaseToken: firstClaim.leaseToken! } })).resolves.toMatchObject({
      status: "failed",
      completedAt: expect.any(Date),
    });

    // Other valid seed jobs share this worker topic. Make this retry the oldest
    // eligible job so the assertion identifies the lease we intentionally expired.
    await prisma.outboxMessage.update({
      where: { id: firstClaim.id },
      data: { availableAt: new Date(0) },
    });
    const [secondClaim] = await claimOutboxMessages({ worker, limit: 1, maintainExpiredLeases: false });
    expect(secondClaim).toMatchObject({ id: firstClaim.id, status: "leased", attemptCount: 2 });
    await expect(prisma.outboxDeliveryAttempt.count({ where: { messageId: firstClaim.id } })).resolves.toBe(2);
  });

  it("claims and completes exact-recipient email jobs", async () => {
    const requests: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        requests.push({ headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
        response.writeHead(202, { "x-message-id": "provider-message-1" });
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test email provider did not bind a TCP port.");
    vi.stubEnv("NOTIFICATION_EMAIL_API_TOKEN", "unit-token");
    vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_URL", `http://127.0.0.1:${address.port}/send`);
    vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_HOSTS", "127.0.0.1");
    vi.stubEnv("NOTIFICATION_EMAIL_FROM", "mouse-colony@colony.local");
    vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_SUPPORTS_IDEMPOTENCY", "true");
    vi.stubEnv("OUTBOX_WORKER_TOKEN_NOTIFICATION_DELIVERY", "unit-worker-token-that-is-at-least-32-characters");
    await prisma.ruleConfig.update({
      where: { key: "notify_email_enabled" },
      data: { value: true },
    });
    await materializeUrgentAlert();

    const result = await deliverNotificationDigest({ dryRun: false }, deliveryActor).finally(
      () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    );

    expect(result.delivered).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0]?.headers.authorization).toBe("Bearer unit-token");
    expect(requests[0]?.headers["idempotency-key"]).toEqual(expect.any(String));
    expect(requests[0]?.body).toContain("mouse-colony@colony.local");
    expect(requests[0]?.body).toContain('"idempotencyKey"');
  });

  it("reuses the durable idempotency key when the provider accepts a request but the connection is lost", async () => {
    const firstAttemptKeys: string[] = [];
    const retryKeys: string[] = [];
    const firstAttemptBodies: string[] = [];
    const retryBodies: string[] = [];
    let retryPhase = false;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        const rawKey = request.headers["idempotency-key"];
        const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
        if (key) (retryPhase ? retryKeys : firstAttemptKeys).push(key);
        (retryPhase ? retryBodies : firstAttemptBodies).push(Buffer.concat(chunks).toString("utf8"));
        if (!retryPhase) {
          request.socket.destroy();
          return;
        }
        response.writeHead(202, { "x-message-id": `provider-${key}` });
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test email provider did not bind a TCP port.");
    vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_URL", `http://127.0.0.1:${address.port}/send`);
    vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_HOSTS", "127.0.0.1");
    vi.stubEnv("NOTIFICATION_EMAIL_FROM", "mouse-colony@colony.local");
    vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_SUPPORTS_IDEMPOTENCY", "true");
    vi.stubEnv("OUTBOX_WORKER_TOKEN_NOTIFICATION_DELIVERY", "unit-worker-token-that-is-at-least-32-characters");
    await prisma.ruleConfig.update({ where: { key: "notify_email_enabled" }, data: { value: true } });
    await materializeUrgentAlert();

    try {
      const firstResult = await deliverNotificationDigest({ dryRun: false }, deliveryActor);
      expect(firstResult.failed).toBeGreaterThan(0);
      expect(firstAttemptKeys.length).toBeGreaterThan(0);
      await prisma.notificationEvent.updateMany({
        where: { message: "Urgent welfare delivery test." },
        data: { message: "Changed after an ambiguous provider acceptance.", version: { increment: 1 } },
      });
      await prisma.outboxMessage.updateMany({
        where: { status: "retry", topic: "notifications.email" },
        data: { availableAt: new Date(0) },
      });
      retryPhase = true;
      const retryResult = await deliverNotificationDigest({ dryRun: false }, deliveryActor);
      expect(retryResult.delivered).toBeGreaterThan(0);
      expect(retryKeys.sort()).toEqual(firstAttemptKeys.sort());
      expect(retryBodies.sort()).toEqual(firstAttemptBodies.sort());
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it.each(["endpoint", "account"] as const)(
    "dead-letters a prepared delivery when its provider %s changes",
    async (changedIdentityPart) => {
      let initialRequestCount = 0;
      let changedProviderRequestCount = 0;
      let retryPhase = false;
      const initialServer = createServer((request, response) => {
        request.resume();
        request.once("end", () => {
          if (retryPhase) {
            changedProviderRequestCount += 1;
            response.writeHead(202);
            response.end();
            return;
          }
          initialRequestCount += 1;
          request.socket.destroy();
        });
      });
      const changedEndpointServer = createServer((request, response) => {
        request.resume();
        request.once("end", () => {
          changedProviderRequestCount += 1;
          response.writeHead(202);
          response.end();
        });
      });
      await new Promise<void>((resolve) => initialServer.listen(0, "127.0.0.1", resolve));
      await new Promise<void>((resolve) => changedEndpointServer.listen(0, "127.0.0.1", resolve));
      const initialAddress = initialServer.address();
      const changedAddress = changedEndpointServer.address();
      if (!initialAddress || typeof initialAddress === "string" || !changedAddress || typeof changedAddress === "string") {
        throw new Error("Test email providers did not bind TCP ports.");
      }
      const initialEndpoint = `http://127.0.0.1:${initialAddress.port}/send`;
      vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_URL", initialEndpoint);
      vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_HOSTS", "127.0.0.1");
      vi.stubEnv("NOTIFICATION_EMAIL_FROM", "mouse-colony@colony.local");
      vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_SUPPORTS_IDEMPOTENCY", "true");
      vi.stubEnv("OUTBOX_WORKER_TOKEN_NOTIFICATION_DELIVERY", "unit-worker-token-that-is-at-least-32-characters");
      await prisma.ruleConfig.update({ where: { key: "notify_email_enabled" }, data: { value: true } });
      await materializeUrgentAlert();

      try {
        const firstResult = await deliverNotificationDigest({ dryRun: false }, deliveryActor);
        expect(firstResult.failed).toBeGreaterThan(0);
        expect(initialRequestCount).toBeGreaterThan(0);
        const preparedDeliveries = await prisma.notificationDelivery.findMany({
          where: { providerEndpoint: initialEndpoint, status: "queued" },
          select: { id: true, outboxMessageId: true, providerAdapter: true, providerAccount: true },
        });
        expect(preparedDeliveries.length).toBeGreaterThan(0);
        expect(preparedDeliveries).toEqual(expect.arrayContaining([
          expect.objectContaining({
            providerAdapter: "http-json-email-v1",
            providerAccount: "mouse-colony@colony.local",
          }),
        ]));
        await prisma.outboxMessage.updateMany({
          where: { id: { in: preparedDeliveries.map((delivery) => delivery.outboxMessageId) }, status: "retry" },
          data: { availableAt: new Date(0) },
        });
        if (changedIdentityPart === "endpoint") {
          vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_URL", `http://127.0.0.1:${changedAddress.port}/send`);
        } else {
          vi.stubEnv("NOTIFICATION_EMAIL_FROM", "replacement-account@colony.local");
          retryPhase = true;
        }

        const retryResult = await deliverNotificationDigest({ dryRun: false }, deliveryActor);
        expect(retryResult.delivered).toBe(0);
        expect(retryResult.failed).toBe(preparedDeliveries.length);
        expect(changedProviderRequestCount).toBe(0);
        await expect(prisma.notificationDelivery.count({
          where: { id: { in: preparedDeliveries.map((delivery) => delivery.id) }, status: "failed" },
        })).resolves.toBe(preparedDeliveries.length);
        await expect(prisma.outboxMessage.count({
          where: { id: { in: preparedDeliveries.map((delivery) => delivery.outboxMessageId) }, status: "dead_letter" },
        })).resolves.toBe(preparedDeliveries.length);
        const finalAttempts = await prisma.outboxDeliveryAttempt.findMany({
          where: {
            messageId: { in: preparedDeliveries.map((delivery) => delivery.outboxMessageId) },
            attemptNumber: 2,
          },
          select: { status: true, completedAt: true, errorMessage: true },
        });
        expect(finalAttempts).toHaveLength(preparedDeliveries.length);
        expect(finalAttempts).toEqual(expect.arrayContaining([
          expect.objectContaining({
            status: "failed",
            completedAt: expect.any(Date),
            errorMessage: expect.stringContaining("operator reconciliation is required"),
          }),
        ]));
      } finally {
        await Promise.all([
          new Promise<void>((resolve, reject) => initialServer.close((error) => error ? reject(error) : resolve())),
          new Promise<void>((resolve, reject) => changedEndpointServer.close((error) => error ? reject(error) : resolve())),
        ]);
      }
    },
  );

  it("forbids non-manager delivery POST requests", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-researcher",
        email: "researcher@colony.local",
        name: "Researcher",
        role: "researcher",
        authzVersion: 1,
      },
    });

    const { POST } = await import("@/app/api/v1/notifications/delivery/route");
    const response = await POST(new Request("http://localhost:3000/api/v1/notifications/delivery", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" });
  });
});
