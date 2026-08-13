import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildNotificationEmailProviderRequest,
  notificationProviderSupportsIdempotency,
  validateNotificationEmailProviderUrl,
} from "@/lib/notification-delivery";

describe("notification provider transport security", () => {
  it.each([
    "https://0.0.0.0/send",
    "https://127.0.0.1/send",
    "https://169.254.169.254/send",
    "https://192.88.99.2/send",
    "https://192.168.10.4/send",
    "https://[::1]/send",
    "https://[::ffff:7f00:1]/send",
    "https://[64:ff9b:1::1]/send",
    "https://[100::1]/send",
    "https://[100:0:0:1::1]/send",
    "https://[2001:2::1]/send",
    "https://[3fff::1]/send",
    "https://[5f00::1]/send",
    "https://[fc00::1]/send",
    "https://[fe80::1]/send",
  ])("rejects production private or reserved provider target %s", (url) => {
    expect(validateNotificationEmailProviderUrl(url, {
      production: true,
      allowedHosts: [new URL(url).hostname],
    })).toMatchObject({ ok: false });
  });

  it.each([
    "https://8.8.8.8/send",
    "https://[2606:4700:4700::1111]/send",
  ])("accepts a production globally routable literal on the explicit allowlist %s", (url) => {
    expect(validateNotificationEmailProviderUrl(url, {
      production: true,
      allowedHosts: [new URL(url).hostname],
    })).toMatchObject({ ok: true });
  });

  it("requires a stable idempotency key and pins the validated address for a bounded no-redirect request", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/notification-delivery.ts"), "utf8");

    expect(source).toContain('"Idempotency-Key": idempotencyKey');
    expect(source).toContain("deliveryId: payload.deliveryId");
    expect(source).toContain("NOTIFICATION_EMAIL_PROVIDER_SUPPORTS_IDEMPOTENCY");
    expect(source).toContain("hostname: pinned?.address");
    expect(source).toContain("servername: normalizeHostname(url.hostname)");
    expect(source).toContain("providerRequest.setTimeout(timeoutMs");
    expect(source).toContain("Email provider request exceeded its hard time limit.");
    expect(source).not.toContain("await fetch(provider.url");
  });

  it("requires an explicit provider idempotency contract", () => {
    expect(notificationProviderSupportsIdempotency(undefined)).toBe(false);
    expect(notificationProviderSupportsIdempotency("false")).toBe(false);
    expect(notificationProviderSupportsIdempotency(" TRUE ")).toBe(true);
  });

  it("reuses the durable delivery key after an ambiguous provider acceptance", () => {
    const firstAttempt = buildNotificationEmailProviderRequest({
      deliveryId: "delivery-durable-123",
      from: "facility@example.test",
      to: "recipient@example.test",
      subject: "Welfare alert",
      text: "Review cage 1001.",
    });
    // A connection can fail after the provider accepted this request. Retrying the same durable job must be identical.
    const retryAttempt = buildNotificationEmailProviderRequest({
      deliveryId: "delivery-durable-123",
      from: "facility@example.test",
      to: "recipient@example.test",
      subject: "Welfare alert",
      text: "Review cage 1001.",
    });

    expect(retryAttempt.headers["Idempotency-Key"]).toBe("delivery-durable-123");
    expect(JSON.parse(retryAttempt.body)).toMatchObject({ idempotencyKey: "delivery-durable-123" });
    expect(retryAttempt).toEqual(firstAttempt);
  });

  it("persists an immutable provider body and performs network I/O outside database transactions", () => {
    const commandSource = fs.readFileSync(path.join(process.cwd(), "src/lib/command-foundation.ts"), "utf8");
    const deliverySource = fs.readFileSync(path.join(process.cwd(), "src/lib/notification-delivery.ts"), "utf8");
    const deliveryFunction = commandSource.slice(
      commandSource.indexOf("export async function deliverClaimedNotificationMessage"),
      commandSource.indexOf("export async function completeOutboxMessage"),
    );

    expect(deliveryFunction).toContain("providerRequestBody: body");
    expect(deliveryFunction).toContain("providerEndpoint: prepared.request.providerEndpoint");
    expect(deliveryFunction).toContain('status: "reconciliation_required"');
    expect(deliveryFunction).toContain('createHash("sha256").update(body).digest("hex")');
    const sendCall = deliveryFunction.indexOf("const receipt = await input.send(prepared.request);");
    const prepareTransactionEnd = deliveryFunction.indexOf('if (prepared.status !== "prepared")');
    const finalizeTransaction = deliveryFunction.indexOf("return prisma.$transaction", sendCall);
    expect(sendCall).toBeGreaterThan(prepareTransactionEnd);
    expect(finalizeTransaction).toBeGreaterThan(sendCall);
    expect(deliverySource).toContain("body: request.body");
    expect(deliverySource).not.toContain("send: async (payload)");
  });
});
