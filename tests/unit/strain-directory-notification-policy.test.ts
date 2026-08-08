import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/command-foundation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/command-foundation")>()),
  executeIdempotentCommand: commandMocks.execute,
}));

import { getNotificationDefinition } from "@/lib/notification-catalog";
import { updateNotificationPreference } from "@/lib/notification-write";
import type { ResolvedActor } from "@/lib/session";

const actor = {
  id: "lab-user-1",
  email: "user@example.test",
  name: "Lab user",
  role: "lab_user",
  databaseRole: "lab_user",
  canonicalRole: "lab_user",
  authzVersion: 1,
  activeLabId: "lab-1",
  activeMembership: { labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "viewer" },
  memberships: [{ labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "viewer" }],
  capabilities: ["notifications:read"],
} as ResolvedActor;

beforeEach(() => commandMocks.execute.mockReset());

describe("strain directory notification policy", () => {
  it("marks the category as in-app-only and rejects email digest preferences before a command is created", async () => {
    expect(getNotificationDefinition("strain_directory_request")).toMatchObject({
      categoryKey: "strain_directory",
      emailAllowed: false,
    });

    const result = await updateNotificationPreference({
      actor,
      categoryKey: "strain_directory",
      inAppEnabled: true,
      emailMode: "daily_digest",
      digestHourUtc: 8,
      digestDayOfWeek: 1,
      expectedVersion: 0,
      idempotencyKey: "strain-directory-email-policy-key",
      requestId: "strain-directory-email-policy-request",
    });

    expect(result).toMatchObject({ ok: false, code: "validation_error" });
    expect(result.message).toMatch(/stay in the app/i);
    expect(commandMocks.execute).not.toHaveBeenCalled();
  });
});
