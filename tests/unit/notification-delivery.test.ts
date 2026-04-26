import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildNotificationDeliveryBatch, deliverNotificationDigest } from "@/lib/notification-delivery";
import { prisma } from "@/lib/prisma";
import { seedDatabase } from "../../prisma/seed-database";

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

describe("notification delivery", () => {
  beforeEach(async () => {
    authMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await seedDatabase();
  }, 120_000);

  it("builds a dry-run delivery batch with email-ready digest content", async () => {
    const batch = await buildNotificationDeliveryBatch();

    expect(batch.notificationCount).toBeGreaterThan(0);
    expect(batch.webhook.enabled).toBe(false);
    expect(batch.webhook.configured).toBe(false);
    expect(batch.emailDigest.enabled).toBe(false);
    expect(batch.emailDigest.configured).toBe(true);
    expect(batch.emailDigest.providerConfigured).toBe(false);
    expect(batch.emailDigest.recipients).toEqual(["manager@colony.local", "staff@colony.local"]);
    expect(batch.emailDigest.subject).toContain("active notifications");
    expect(batch.emailDigest.bodyText).toContain("Action:");
  });

  it("posts the notification batch when webhook delivery is enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);

    await prisma.ruleConfig.update({
      where: { key: "notify_webhook_enabled" },
      data: { value: true },
    });
    await prisma.ruleConfig.update({
      where: { key: "notify_webhook_url" },
      data: { value: "https://example.test/colony-notifications" },
    });

    const result = await deliverNotificationDigest({ dryRun: false });

    expect(result.delivered).toBe(true);
    expect(result.status).toBe(202);
    expect(result.channelResults).toHaveLength(1);
    expect(result.channelResults[0]).toMatchObject({ channel: "webhook", delivered: true, status: 202 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/colony-notifications",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("posts the digest to a configured HTTP email provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NOTIFICATION_EMAIL_API_TOKEN", "unit-token");

    await prisma.ruleConfig.update({
      where: { key: "notify_email_enabled" },
      data: { value: true },
    });
    await prisma.ruleConfig.update({
      where: { key: "notify_email_provider_url" },
      data: { value: "https://email.example.test/send" },
    });

    const result = await deliverNotificationDigest({ dryRun: false });

    expect(result.delivered).toBe(true);
    expect(result.status).toBe(202);
    expect(result.channelResults).toEqual([
      expect.objectContaining({ channel: "email", delivered: true, status: 202 }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://email.example.test/send",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer unit-token",
        },
        body: expect.stringContaining("mouse-colony@colony.local"),
      }),
    );
  });

  it("forbids non-manager delivery POST requests", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-researcher",
        email: "researcher@colony.local",
        name: "Researcher",
        role: "researcher",
      },
    });

    const { POST } = await import("@/app/api/v1/notifications/delivery/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/notifications/delivery", {
        method: "POST",
        body: JSON.stringify({ dryRun: true }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" });
  });
});
