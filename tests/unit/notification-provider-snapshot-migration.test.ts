import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.join(process.cwd(), "prisma/migrations/0033_notification_provider_snapshot/migration.sql"),
  "utf8",
);
const materialization = fs.readFileSync(path.join(process.cwd(), "src/lib/notification-materialization.ts"), "utf8");
const commandFoundation = fs.readFileSync(path.join(process.cwd(), "src/lib/command-foundation.ts"), "utf8");

describe("notification provider snapshot migration", () => {
  it("binds every new delivery and outbox payload to an exact event version", () => {
    expect(migration).toContain('ADD COLUMN "eventVersion" INTEGER');
    expect(migration).toContain('outbox_row.payload->>\'eventVersion\' IS DISTINCT FROM NEW."eventVersion"::text');
    expect(materialization).toContain("eventVersion: input.event.version");
    expect(commandFoundation).toContain("payload.eventVersion !== delivery.eventVersion");
    expect(commandFoundation).toContain("delivery.providerRequestBody === null && delivery.eventVersion !== event.version");
  });

  it("makes a complete provider request snapshot immutable after preparation", () => {
    expect(migration).toContain('ADD COLUMN "providerRequestBody" TEXT');
    expect(migration).toContain('ADD COLUMN "providerAdapter" TEXT');
    expect(migration).toContain('ADD COLUMN "providerEndpoint" TEXT');
    expect(migration).toContain('ADD COLUMN "providerAccount" TEXT');
    expect(migration).toContain('"providerIdempotencyKey" = id');
    expect(migration).toContain('OLD."providerRequestBody" IS NOT NULL');
    expect(migration).toContain('NEW."providerEndpoint" IS DISTINCT FROM OLD."providerEndpoint"');
    expect(migration).toContain('"providerAdapter" IS NOT NULL');
    expect(migration).toContain('"providerEndpoint" IS NOT NULL');
    expect(migration).toContain('"providerAccount" IS NOT NULL');
    expect(migration).toContain("provider snapshot, or terminal history is immutable");
  });

  it("cancels pre-snapshot queued jobs rather than retrying mutable legacy content", () => {
    expect(migration).toContain("Legacy notification delivery was cancelled before immutable provider snapshot activation.");
    expect(migration).toContain("UPDATE \"OutboxMessage\" message");
    expect(migration).toContain("UPDATE \"NotificationDelivery\"");
    const closeAttempt = migration.indexOf('UPDATE "OutboxDeliveryAttempt" attempt');
    const cancelMessage = migration.indexOf('UPDATE "OutboxMessage" message');
    expect(closeAttempt).toBeGreaterThan(-1);
    expect(closeAttempt).toBeLessThan(cancelMessage);
    expect(migration.slice(closeAttempt, cancelMessage)).toContain("attempt.status = 'processing'");
    expect(migration.slice(closeAttempt, cancelMessage)).toContain("status = 'failed'");
    expect(migration.slice(closeAttempt, cancelMessage)).toContain('"completedAt" = CURRENT_TIMESTAMP');
  });
});
