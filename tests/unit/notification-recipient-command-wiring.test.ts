import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/command-foundation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/command-foundation")>()),
  executeIdempotentCommand: commandMocks.execute,
}));

import { executeNotificationRecipientAction, updateNotificationPreference } from "@/lib/notification-write";
import type { ResolvedActor } from "@/lib/session";

const actor = {
  id: "lab-staff-1",
  email: "staff@example.test",
  name: "Lab staff",
  role: "animal_staff",
  databaseRole: "animal_staff",
  canonicalRole: "lab_user",
  authzVersion: 4,
  activeLabId: "lab-1",
  activeMembership: { labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "staff" },
  memberships: [{ labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "staff" }],
  capabilities: ["notifications:read"],
} as ResolvedActor;

describe("notification recipient command wiring", () => {
  beforeEach(() => {
    commandMocks.execute.mockReset();
    commandMocks.execute.mockResolvedValue({ ok: true, result: { message: "ok" } });
  });

  it.each(["read", "acknowledge", "resolve"] as const)(
    "binds %s to the exact recipient, actor, and expected version",
    async (action) => {
      await executeNotificationRecipientAction({
        actor,
        recipientId: " recipient-1 ",
        action,
        expectedVersion: 3,
        idempotencyKey: `notification-${action}-key`,
        requestId: `notification-${action}-request`,
      });

      expect(commandMocks.execute).toHaveBeenCalledWith(expect.objectContaining({
        actor,
        commandType: `notification.recipient.${action}`,
        requiredCapability: "notifications:read",
        aggregateType: "notification_recipient",
        aggregateId: "recipient-1",
        expectedVersion: 3,
        request: { recipientId: "recipient-1", action },
      }));
    },
  );

  it("rejects malformed actions before a command receipt is created", async () => {
    const result = await executeNotificationRecipientAction({
      actor,
      recipientId: "",
      action: "read",
      expectedVersion: 0,
      idempotencyKey: "invalid-key",
      requestId: "invalid-request",
    });

    expect(result).toMatchObject({ ok: false, code: "validation_error" });
    expect(commandMocks.execute).not.toHaveBeenCalled();
  });

  it("binds personal delivery preferences to the exact actor and expected version", async () => {
    await updateNotificationPreference({
      actor,
      categoryKey: "weaning_due",
      inAppEnabled: true,
      emailMode: "daily_digest",
      digestHourUtc: 9,
      digestDayOfWeek: 1,
      expectedVersion: 2,
      idempotencyKey: "notification-preference-key",
      requestId: "notification-preference-request",
    });

    expect(commandMocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      commandType: "notification.preference.update",
      requiredCapability: "notifications:read",
      aggregateType: "notification_preference",
      expectedVersion: 2,
      request: {
        categoryKey: "weaning_due",
        inAppEnabled: true,
        emailMode: "daily_digest",
        digestHourUtc: 9,
        digestDayOfWeek: 1,
      },
    }));
  });
});
