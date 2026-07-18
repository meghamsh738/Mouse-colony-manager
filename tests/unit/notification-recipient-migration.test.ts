import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../prisma/migrations/0023_notification_recipients/migration.sql", import.meta.url),
  "utf8",
);
const deliveryMigration = readFileSync(
  new URL("../../prisma/migrations/0024_notification_delivery/migration.sql", import.meta.url),
  "utf8",
);
const deliveryHardeningMigration = readFileSync(
  new URL("../../prisma/migrations/0025_notification_delivery_hardening/migration.sql", import.meta.url),
  "utf8",
);

describe("notification recipient migration", () => {
  it("separates durable events, explicit audiences, and exact recipients", () => {
    expect(migration).toContain('CREATE TABLE "NotificationEvent"');
    expect(migration).toContain('CREATE TABLE "NotificationAudience"');
    expect(migration).toContain('CREATE TABLE "NotificationRecipient"');
    expect(migration).toContain('CONSTRAINT "NotificationRecipient_eventId_userId_key" UNIQUE');
    expect(deliveryMigration).toContain('DROP CONSTRAINT "NotificationRecipient_eventId_userId_key"');
    expect(deliveryMigration).toContain('"NotificationRecipient_eventId_userId_active_key"');
    expect(migration).toContain('CONSTRAINT "NotificationAudience_payload_check" CHECK');
  });

  it("binds preferences and deliveries to exact recipient generations and outbox payloads", () => {
    expect(deliveryMigration).toContain('CREATE TABLE "NotificationPreference"');
    expect(deliveryMigration).toContain('CREATE TABLE "NotificationDelivery"');
    expect(deliveryMigration).toContain('CREATE FUNCTION "validate_notification_delivery_binding"()');
    expect(deliveryMigration).toContain("Notification delivery is not bound to a current recipient and exact outbox payload");
    expect(deliveryHardeningMigration).toContain('UNIQUE ("recipientId", kind, "preferenceVersion")');
    expect(deliveryHardeningMigration).not.toContain('recipient_row.version IS DISTINCT FROM NEW."recipientVersion"');
    expect(deliveryHardeningMigration).toContain("active recipient generation and exact outbox payload");
    expect(deliveryMigration).toContain('OLD.status = \'revoked\'');
  });

  it("requires current user, role, membership, and event binding", () => {
    expect(migration).toContain('CREATE FUNCTION "validate_notification_recipient_binding"()');
    expect(migration).toContain('NEW."recipientAuthzVersion" IS DISTINCT FROM user_row."authzVersion"');
    expect(migration).toContain('NEW."recipientMembershipRole" IS DISTINCT FROM membership_row.role');
    expect(migration).toContain("Notification recipient identity is not current or event-scoped");
  });

  it("keeps notification history append-only and versioned", () => {
    expect(migration).toContain('CREATE TRIGGER "NotificationEvent_history_guard"');
    expect(migration).toContain('CREATE TRIGGER "NotificationAudience_history_guard"');
    expect(migration).toContain('CREATE TRIGGER "NotificationRecipient_history_guard"');
    expect(migration).toContain("Notification recipient history cannot be deleted or truncated");
    expect(migration).toContain("NEW.version <> OLD.version + 1");
  });
});
