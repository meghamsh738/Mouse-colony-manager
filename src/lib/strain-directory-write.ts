import { randomUUID } from "node:crypto";

import { Prisma, type StrainDirectoryListingStatus, type StrainDirectoryRequestStatus } from "@prisma/client";

import { canonicalJsonHash, executeIdempotentCommand, staleConflict } from "@/lib/command-foundation";
import { canManageLab, getActorLabAccess } from "@/lib/lab-access";
import type { ResolvedActor } from "@/lib/session";

const nonLabDirectoryRoles = ["it_head", "facility_admin", "cmu_staff", "admin", "colony_manager"] as const;

type CommandIdentity = {
  idempotencyKey: string;
  requestId: string;
};

export type CreateStrainDirectoryListingCommand = {
  labId: string;
  strainId: string;
  contactUserId: string;
};

export type UpdateStrainDirectoryListingCommand = {
  listingId: string;
  contactUserId: string;
  status: StrainDirectoryListingStatus;
};

export type SubmitStrainDirectoryRequestCommand = {
  listingId: string;
  requestType: "contact" | "material";
  purpose?: string | null;
};

export type DecideStrainDirectoryRequestCommand = {
  requestId: string;
  action: "accepted" | "declined";
  reason?: string | null;
};

function validationError(message: string) {
  return { ok: false as const, code: "validation_error", message };
}

function notFoundError(message = "The requested directory record was not found.") {
  return { ok: false as const, code: "not_found", message };
}

function normalizeOptional(value?: string | null) {
  return value?.trim() || null;
}

function actorLabId(actor: ResolvedActor) {
  return actor.canonicalRole === "lab_user" ? actor.activeLabId ?? null : null;
}

async function canManageDirectoryLab(
  tx: Prisma.TransactionClient,
  actor: ResolvedActor,
  labId: string,
) {
  const access = await getActorLabAccess(actor, tx);
  return canManageLab(access, labId)
    && (access.canViewAll || ["owner", "manager"].includes(access.membershipByLabId.get(labId) ?? ""));
}

async function getActiveDirectoryContact(
  tx: Prisma.TransactionClient,
  labId: string,
  userId: string,
) {
  return tx.labMembership.findFirst({
    where: {
      labId,
      userId,
      active: true,
      role: { in: ["owner", "manager"] },
      lab: { active: true },
      user: { active: true, role: { notIn: [...nonLabDirectoryRoles] } },
    },
    select: { labId: true, userId: true, role: true },
  });
}

async function hasDirectoryAvailability(
  tx: Prisma.TransactionClient,
  strainId: string,
  labId: string,
) {
  const [animal, cryostorage] = await Promise.all([
    tx.animal.findFirst({
      where: {
        strainId,
        owningLabId: labId,
        status: { notIn: ["euthanized", "dead", "transferred_out", "archived"] },
      },
      select: { id: true },
    }),
    tx.cryostorageRecord.findFirst({
      where: { strainId, labId, status: { in: ["stored", "reserved"] } },
      select: { id: true },
    }),
  ]);
  return Boolean(animal || cryostorage);
}

async function writeDirectoryAudit(
  tx: Prisma.TransactionClient,
  input: {
    actor: ResolvedActor;
    entityType: "strain_directory_listing" | "strain_directory_request";
    entityId: string;
    labId?: string | null;
    action: string;
    previousValue?: Prisma.InputJsonValue;
    newValue?: Prisma.InputJsonValue;
  },
) {
  await tx.auditLog.create({
    data: {
      id: randomUUID(),
      actorId: input.actor.id,
      actorRole: input.actor.databaseRole,
      labId: input.labId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      previousValue: input.previousValue ?? Prisma.JsonNull,
      newValue: input.newValue ?? Prisma.JsonNull,
      timestamp: new Date(),
    },
  });
}

async function writeDirectoryRequestEvent(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string;
    eventType: "submitted" | "accepted" | "declined" | "cancelled";
    actor: ResolvedActor;
    reason?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
) {
  await tx.strainDirectoryRequestEvent.create({
    data: {
      id: randomUUID(),
      requestId: input.requestId,
      eventType: input.eventType,
      actorId: input.actor.id,
      actorRole: input.actor.databaseRole,
      actorLabId: actorLabId(input.actor),
      reason: input.reason ?? null,
      metadata: input.metadata,
    },
  });
}

async function writePrivateDirectoryNotification(
  tx: Prisma.TransactionClient,
  input: {
    recipientUserId: string;
    labId: string;
    sourceKey: string;
    message: string;
    requestId: string;
  },
) {
  const recipient = await tx.labMembership.findFirst({
    where: {
      labId: input.labId,
      userId: input.recipientUserId,
      active: true,
      lab: { active: true },
      user: { active: true },
    },
    select: {
      role: true,
      user: { select: { id: true, authzVersion: true, role: true } },
    },
  });
  if (!recipient) return;

  const eventId = randomUUID();
  const audienceId = randomUUID();
  await tx.notificationEvent.create({
    data: {
      id: eventId,
      sourceKey: input.sourceKey,
      source: "strain_directory",
      labId: input.labId,
      categoryKey: "strain_directory",
      severity: "info",
      message: input.message,
      entityType: "strain_directory_request",
      entityId: input.requestId,
      deepLink: "/strains",
      actionLabel: "Open directory",
      urgent: false,
      status: "open",
      occurredAt: new Date(),
    },
  });
  await tx.notificationAudience.create({
    data: {
      id: audienceId,
      eventId,
      audienceType: "user",
      audienceKey: `user:${recipient.user.id}`,
      userId: recipient.user.id,
      labId: null,
      facilityRole: null,
    },
  });
  await tx.notificationRecipient.create({
    data: {
      id: randomUUID(),
      eventId,
      audienceId,
      userId: recipient.user.id,
      labId: input.labId,
      recipientAuthzVersion: recipient.user.authzVersion,
      recipientRole: recipient.user.role,
      recipientMembershipRole: recipient.role,
    },
  });
}

export async function executeCreateStrainDirectoryListingCommand(input: {
  actor: ResolvedActor;
  command: CreateStrainDirectoryListingCommand;
} & CommandIdentity) {
  const command = {
    labId: input.command.labId.trim(),
    strainId: input.command.strainId.trim(),
    contactUserId: input.command.contactUserId.trim(),
  };
  if (!command.labId || !command.strainId || !command.contactUserId) {
    return validationError("Choose a holding lab, an existing strain, and an active owner or manager as contact.");
  }
  const listingId = `strain-listing-${canonicalJsonHash({
    labId: command.labId,
    strainId: command.strainId,
  }).slice(0, 32)}`;

  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "strain_directory.listing.create",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command,
    requiredCapability: "strains:manage",
    labId: command.labId,
    aggregateType: "strain_directory_listing",
    aggregateId: listingId,
    handler: async (tx) => {
      if (!await canManageDirectoryLab(tx, input.actor, command.labId)) {
        return notFoundError("Lab not found.");
      }
      const [strain, existing, contact] = await Promise.all([
        tx.strain.findUnique({ where: { id: command.strainId }, select: { id: true } }),
        tx.strainDirectoryListing.findUnique({
          where: { strainId_labId: { strainId: command.strainId, labId: command.labId } },
          select: { id: true },
        }),
        getActiveDirectoryContact(tx, command.labId, command.contactUserId),
      ]);
      if (!strain) return validationError("Choose an existing strain. The directory does not create duplicate strain records.");
      if (existing) return validationError("This lab already has a directory listing for that canonical strain.");
      if (!contact) return validationError("Choose an active owner or manager in the selected lab as directory contact.");

      const listing = await tx.strainDirectoryListing.create({
        data: {
          id: listingId,
          labId: command.labId,
          strainId: command.strainId,
          contactUserId: command.contactUserId,
          status: "draft",
          sharedAt: null,
        },
      });
      await writeDirectoryAudit(tx, {
        actor: input.actor,
        entityType: "strain_directory_listing",
        entityId: listing.id,
        labId: listing.labId,
        action: "create_draft",
        newValue: {
          strainId: listing.strainId,
          contactUserId: listing.contactUserId,
          status: listing.status,
          version: listing.version,
        },
      });
      return {
        ok: true as const,
        result: {
          listingId: listing.id,
          version: listing.version,
          message: "Private strain-directory draft created. The selected contact must confirm sharing before it is visible unit-wide.",
        },
        resultingVersion: listing.version,
      };
    },
  });
}

export async function executeUpdateStrainDirectoryListingCommand(input: {
  actor: ResolvedActor;
  command: UpdateStrainDirectoryListingCommand;
  expectedVersion: number;
} & CommandIdentity) {
  const command = {
    listingId: input.command.listingId.trim(),
    contactUserId: input.command.contactUserId.trim(),
    status: input.command.status,
  };
  if (!command.listingId || !command.contactUserId || !["draft", "shared", "paused"].includes(command.status)) {
    return validationError("Directory listing details are invalid.");
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return validationError("Refresh the directory listing and try again.");
  }

  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "strain_directory.listing.update",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command,
    requiredCapability: "strains:manage",
    labId: actorLabId(input.actor),
    aggregateType: "strain_directory_listing",
    aggregateId: command.listingId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      const listing = await tx.strainDirectoryListing.findUnique({
        where: { id: command.listingId },
        select: { id: true, labId: true, strainId: true, contactUserId: true, status: true, version: true },
      });
      if (!listing || !await canManageDirectoryLab(tx, input.actor, listing.labId)) return notFoundError();
      const contact = await getActiveDirectoryContact(tx, listing.labId, command.contactUserId);
      if (!contact) return validationError("Choose an active owner or manager in the holding lab as directory contact.");

      const contactChanged = listing.contactUserId !== command.contactUserId;
      const pendingRequests = contactChanged
        ? await tx.strainDirectoryRequest.findMany({
          where: { listingId: listing.id, status: "submitted" },
          select: { id: true },
        })
        : [];
      const currentContact = contactChanged
        ? await getActiveDirectoryContact(tx, listing.labId, listing.contactUserId)
        : contact;
      const reassigningInactiveContact = contactChanged && pendingRequests.length > 0 && !currentContact;
      if (contactChanged && pendingRequests.length > 0 && currentContact) {
        return validationError("Resolve all pending directory requests before changing the listing contact.");
      }
      if (command.status === "shared") {
        if (contactChanged) {
          return validationError("Changing the contact saves a private draft. The newly selected contact must separately confirm unit-wide sharing.");
        }
        if (input.actor.id !== command.contactUserId) {
          return validationError("Only the selected directory contact can confirm unit-wide sharing.");
        }
        if (!await hasDirectoryAvailability(tx, listing.strainId, listing.labId)) {
          return validationError("A listing can be shared only while this lab has an active colony or cryopreserved material for the strain.");
        }
      }

      const nextStatus: StrainDirectoryListingStatus = contactChanged ? "draft" : command.status;
      const updated = await tx.strainDirectoryListing.updateMany({
        where: { id: listing.id, version: input.expectedVersion },
        data: {
          contactUserId: command.contactUserId,
          status: nextStatus,
          sharedAt: nextStatus === "shared" ? new Date() : null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        const current = await tx.strainDirectoryListing.findUnique({ where: { id: listing.id }, select: { version: true } });
        const conflict = staleConflict("strain_directory_listing", listing.id, input.expectedVersion, current?.version ?? null);
        return { ...conflict, result: conflict as unknown as Prisma.InputJsonValue };
      }
      const saved = await tx.strainDirectoryListing.findUniqueOrThrow({ where: { id: listing.id } });
      await writeDirectoryAudit(tx, {
        actor: input.actor,
        entityType: "strain_directory_listing",
        entityId: saved.id,
        labId: actorLabId(input.actor),
        action: reassigningInactiveContact ? "reassign_inactive_contact_save_draft" : contactChanged ? "change_contact_save_draft" : `set_${nextStatus}`,
        previousValue: {
          contactUserId: listing.contactUserId,
          status: listing.status,
          version: listing.version,
        },
        newValue: {
          contactUserId: saved.contactUserId,
          status: saved.status,
          version: saved.version,
        },
      });
      if (reassigningInactiveContact) {
        await Promise.all(pendingRequests.map((request) => writePrivateDirectoryNotification(tx, {
          recipientUserId: saved.contactUserId,
          labId: saved.labId,
          sourceKey: `strain-directory-request:${request.id}:contact-reassigned:${saved.version}`,
          message: "You were assigned as directory contact for a listing with a pending private request.",
          requestId: request.id,
        })));
      }
      return {
        ok: true as const,
        result: {
          listingId: saved.id,
          status: saved.status,
          version: saved.version,
          message: reassigningInactiveContact
            ? "Inactive directory contact reassigned; the listing is now a private draft and the new contact was notified about pending requests."
            : contactChanged
            ? "Directory contact updated; the listing is now a private draft until the new contact confirms sharing."
            : nextStatus === "shared"
              ? "Listing is now visible in the unit-wide directory."
              : nextStatus === "paused"
                ? "Listing is paused and no longer visible unit-wide."
                : "Listing saved as a private draft.",
        },
        resultingVersion: saved.version,
      };
    },
  });
}

export async function executeSubmitStrainDirectoryRequestCommand(input: {
  actor: ResolvedActor;
  command: SubmitStrainDirectoryRequestCommand;
} & CommandIdentity) {
  const command = {
    listingId: input.command.listingId.trim(),
    requestType: input.command.requestType,
    purpose: normalizeOptional(input.command.purpose),
  };
  const requesterLabId = actorLabId(input.actor);
  if (!requesterLabId) return validationError("Select an active lab before sending a directory request.");
  if (!command.listingId || !["contact", "material"].includes(command.requestType)) {
    return validationError("Choose a valid directory request type.");
  }
  if (command.purpose && (command.purpose.length < 3 || command.purpose.length > 500)) {
    return validationError("Keep the request note between 3 and 500 characters.");
  }
  const directoryRequestId = `strain-request-${canonicalJsonHash({
    actorId: input.actor.id,
    listingId: command.listingId,
    idempotencyKey: input.idempotencyKey.trim(),
  }).slice(0, 32)}`;

  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "strain_directory.request.submit",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command,
    requiredCapability: "strains:request",
    labId: requesterLabId,
    aggregateType: "strain_directory_request",
    aggregateId: directoryRequestId,
    handler: async (tx) => {
      const access = await getActorLabAccess(input.actor, tx);
      if (!access.memberLabIds.includes(requesterLabId)) return notFoundError("Requester lab not found.");
      const listing = await tx.strainDirectoryListing.findFirst({
        where: {
          id: command.listingId,
          status: "shared",
          lab: { active: true },
          contact: {
            active: true,
            role: { in: ["owner", "manager"] },
            user: { active: true, role: { notIn: [...nonLabDirectoryRoles] } },
          },
        },
        select: { id: true, labId: true, contactUserId: true, strain: { select: { name: true } } },
      });
      if (!listing) return notFoundError("That directory listing is no longer shared.");
      if (listing.labId === requesterLabId) return validationError("Your lab already holds this strain; cross-lab requests are only for another lab's listing.");

      const request = await tx.strainDirectoryRequest.create({
        data: {
          id: directoryRequestId,
          listingId: listing.id,
          requesterUserId: input.actor.id,
          requesterLabId,
          requestType: command.requestType,
          purpose: command.purpose,
        },
      });
      await Promise.all([
        writeDirectoryRequestEvent(tx, {
          requestId: request.id,
          eventType: "submitted",
          actor: input.actor,
          metadata: { requestType: request.requestType },
        }),
        writeDirectoryAudit(tx, {
          actor: input.actor,
          entityType: "strain_directory_request",
          entityId: request.id,
          labId: requesterLabId,
          action: "submit",
          newValue: {
            listingId: request.listingId,
            requesterLabId: request.requesterLabId,
            requestType: request.requestType,
            status: request.status,
            version: request.version,
          },
        }),
        writePrivateDirectoryNotification(tx, {
          recipientUserId: listing.contactUserId,
          labId: listing.labId,
          sourceKey: `strain-directory-request:${request.id}:submitted`,
          message: `A lab sent a ${request.requestType === "material" ? "material" : "contact"} request for ${listing.strain.name}.`,
          requestId: request.id,
        }),
      ]);
      return {
        ok: true as const,
        result: {
          requestId: request.id,
          version: request.version,
          message: "Private request sent to the selected directory contact. No email address was shared.",
        },
        resultingVersion: request.version,
      };
    },
  });
}

export async function executeDecideStrainDirectoryRequestCommand(input: {
  actor: ResolvedActor;
  command: DecideStrainDirectoryRequestCommand;
  expectedVersion: number;
} & CommandIdentity) {
  const command = {
    requestId: input.command.requestId.trim(),
    action: input.command.action,
    reason: normalizeOptional(input.command.reason),
  };
  if (!command.requestId || !["accepted", "declined"].includes(command.action)) {
    return validationError("Directory request details are invalid.");
  }
  if (command.reason && (command.reason.length < 3 || command.reason.length > 500)) {
    return validationError("Keep the response note between 3 and 500 characters.");
  }
  if (command.action === "declined" && !command.reason) return validationError("Give a brief reason when declining a request.");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return validationError("Refresh the request and try again.");
  }

  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "strain_directory.request.decide",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command,
    requiredCapability: "strains:manage",
    labId: actorLabId(input.actor),
    aggregateType: "strain_directory_request",
    aggregateId: command.requestId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      const request = await tx.strainDirectoryRequest.findUnique({
        where: { id: command.requestId },
        select: {
          id: true,
          status: true,
          version: true,
          requesterUserId: true,
          requesterLabId: true,
          listing: { select: { labId: true, contactUserId: true, strain: { select: { name: true } } } },
        },
      });
      if (!request) return notFoundError("Directory request not found.");
      if (request.status !== "submitted") return validationError("This directory request has already been decided.");
      if (request.listing.contactUserId !== input.actor.id) {
        return notFoundError("Only the selected directory contact can respond to this request.");
      }
      if (!await getActiveDirectoryContact(tx, request.listing.labId, input.actor.id)) {
        return notFoundError("Your directory-contact assignment is no longer active.");
      }

      const now = new Date();
      const updated = await tx.strainDirectoryRequest.updateMany({
        where: { id: request.id, status: "submitted", version: input.expectedVersion },
        data: {
          status: command.action as StrainDirectoryRequestStatus,
          decidedById: input.actor.id,
          decidedAt: now,
          decisionReason: command.reason,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        const current = await tx.strainDirectoryRequest.findUnique({ where: { id: request.id }, select: { version: true } });
        const conflict = staleConflict("strain_directory_request", request.id, input.expectedVersion, current?.version ?? null);
        return { ...conflict, result: conflict as unknown as Prisma.InputJsonValue };
      }
      const saved = await tx.strainDirectoryRequest.findUniqueOrThrow({ where: { id: request.id } });
      await Promise.all([
        writeDirectoryRequestEvent(tx, {
          requestId: saved.id,
          eventType: command.action,
          actor: input.actor,
          reason: command.reason,
        }),
        writeDirectoryAudit(tx, {
          actor: input.actor,
          entityType: "strain_directory_request",
          entityId: saved.id,
          labId: request.listing.labId,
          action: command.action,
          previousValue: { status: request.status, version: request.version },
          newValue: { status: saved.status, version: saved.version },
        }),
        writePrivateDirectoryNotification(tx, {
          recipientUserId: saved.requesterUserId,
          labId: saved.requesterLabId,
          sourceKey: `strain-directory-request:${saved.id}:${command.action}`,
          message: `Your request for ${request.listing.strain.name} was ${command.action}.`,
          requestId: saved.id,
        }),
      ]);
      return {
        ok: true as const,
        result: {
          requestId: saved.id,
          status: saved.status,
          version: saved.version,
          message: command.action === "accepted" ? "Request accepted and the requesting lab was notified privately." : "Request declined and the requesting lab was notified privately.",
        },
        resultingVersion: saved.version,
      };
    },
  });
}
