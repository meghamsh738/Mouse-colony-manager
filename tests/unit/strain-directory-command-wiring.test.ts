import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/command-foundation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/command-foundation")>()),
  executeIdempotentCommand: commandMocks.execute,
}));

import {
  executeCreateStrainDirectoryListingCommand,
  executeDecideStrainDirectoryRequestCommand,
  executeSubmitStrainDirectoryRequestCommand,
  executeUpdateStrainDirectoryListingCommand,
} from "@/lib/strain-directory-write";
import type { ResolvedActor } from "@/lib/session";

const manager = {
  id: "manager-1",
  email: "manager@example.test",
  name: "Lab manager",
  role: "animal_staff",
  databaseRole: "lab_user",
  canonicalRole: "lab_user",
  authzVersion: 4,
  activeLabId: "lab-1",
  activeMembership: { labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "manager" },
  memberships: [{ labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "manager" }],
  capabilities: ["strains:discover", "strains:request", "strains:manage"],
} as ResolvedActor;

beforeEach(() => {
  commandMocks.execute.mockReset();
  commandMocks.execute.mockResolvedValue({ ok: true, result: { message: "ok" } });
});

describe("strain directory command wiring", () => {
  it("creates private listings through manager authority for the selected lab", async () => {
    await executeCreateStrainDirectoryListingCommand({
      actor: manager,
      command: { labId: " lab-1 ", strainId: " strain-1 ", contactUserId: " owner-1 " },
      idempotencyKey: "strain-directory-create-key",
      requestId: "strain-directory-create-request",
    });

    expect(commandMocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      commandType: "strain_directory.listing.create",
      requiredCapability: "strains:manage",
      labId: "lab-1",
      aggregateType: "strain_directory_listing",
      request: { labId: "lab-1", strainId: "strain-1", contactUserId: "owner-1" },
    }));
  });

  it("requires a selected requester lab and keeps a request bound to its active lab", async () => {
    const noLabActor = { ...manager, activeLabId: null, activeMembership: null, memberships: [] };
    const invalid = await executeSubmitStrainDirectoryRequestCommand({
      actor: noLabActor,
      command: { listingId: "listing-1", requestType: "contact" },
      idempotencyKey: "strain-directory-invalid-request-key",
      requestId: "strain-directory-invalid-request",
    });
    expect(invalid).toMatchObject({ ok: false, code: "validation_error" });
    expect(commandMocks.execute).not.toHaveBeenCalled();

    await executeSubmitStrainDirectoryRequestCommand({
      actor: manager,
      command: { listingId: " listing-1 ", requestType: "material", purpose: " Please contact us. " },
      idempotencyKey: "strain-directory-request-key",
      requestId: "strain-directory-request",
    });
    expect(commandMocks.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      commandType: "strain_directory.request.submit",
      requiredCapability: "strains:request",
      labId: "lab-1",
      aggregateType: "strain_directory_request",
      request: { listingId: "listing-1", requestType: "material", purpose: "Please contact us." },
    }));
  });

  it("uses optimistic versions for sharing and private request decisions", async () => {
    await executeUpdateStrainDirectoryListingCommand({
      actor: manager,
      command: { listingId: "listing-1", contactUserId: "manager-1", status: "shared" },
      expectedVersion: 2,
      idempotencyKey: "strain-directory-listing-update-key",
      requestId: "strain-directory-listing-update",
    });
    expect(commandMocks.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      commandType: "strain_directory.listing.update",
      aggregateType: "strain_directory_listing",
      aggregateId: "listing-1",
      expectedVersion: 2,
    }));

    await executeDecideStrainDirectoryRequestCommand({
      actor: manager,
      command: { requestId: "request-1", action: "declined", reason: "Capacity is temporarily unavailable." },
      expectedVersion: 3,
      idempotencyKey: "strain-directory-request-decision-key",
      requestId: "strain-directory-request-decision",
    });
    expect(commandMocks.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      commandType: "strain_directory.request.decide",
      requiredCapability: "strains:manage",
      aggregateType: "strain_directory_request",
      aggregateId: "request-1",
      expectedVersion: 3,
    }));
  });
});
