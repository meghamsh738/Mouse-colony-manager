import { randomUUID } from "node:crypto";

import { Prisma, type CryostorageStatus } from "@prisma/client";

import { canonicalJsonHash, executeIdempotentCommand } from "@/lib/command-foundation";
import { canManageLab, getActorLabAccess } from "@/lib/lab-access";
import type { ResolvedActor } from "@/lib/session";

type CommandIdentity = {
  idempotencyKey: string;
  requestId: string;
};

type CryostorageExecutionResult = {
  requestId: string;
  recordId?: string;
  version: number;
  message: string;
};

export type SubmitCryostorageRequestCommand = {
  labId: string;
  requestType: "store" | "recover" | "discard";
  targetRecordId?: string | null;
  strainId?: string | null;
  projectId?: string | null;
  sampleLabel?: string | null;
  materialType?: string | null;
  requestedQuantityLabel?: string | null;
  requestedStorageLocation?: string | null;
  requestedFor: string;
  notes?: string | null;
};

export type ExecuteCryostorageRequestCommand = {
  requestId: string;
  labId: string;
  action: "complete" | "reject";
  performedAt?: string | null;
  resultingStatus?: "recovered" | "depleted" | null;
  storageLocation?: string | null;
  quantityLabel?: string | null;
  reason?: string | null;
  operationNotes?: string | null;
};

function validationError(message: string) {
  return { ok: false as const, code: "validation_error", message };
}

function normalizeOptional(value?: string | null) {
  return value?.trim() || null;
}

function parseCalendarDate(value?: string | null) {
  const normalized = value?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== normalized ? null : date;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function actorLabId(actor: ResolvedActor) {
  return actor.canonicalRole === "lab_user" ? actor.activeLabId : null;
}

async function bindCryostorageCommandContext(
  tx: Prisma.TransactionClient,
  input: { receiptId: string; actorId: string; commandType: string },
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT
      set_config('mcm.cryostorage_receipt_id', ${input.receiptId}, true),
      set_config('mcm.cryostorage_actor_id', ${input.actorId}, true),
      set_config('mcm.cryostorage_command_type', ${input.commandType}, true)
  `);
}

async function writeCryostorageEvent(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string;
    eventType: "submitted" | "completed" | "rejected" | "cancelled";
    actor: ResolvedActor;
    reason?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
) {
  return tx.cryostorageRequestEvent.create({
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

async function writeCryostorageAudit(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string;
    actorId: string;
    action: string;
    previousValue?: Prisma.InputJsonValue;
    newValue?: Prisma.InputJsonValue;
  },
) {
  return tx.auditLog.create({
    data: {
      id: randomUUID(),
      actorId: input.actorId,
      entityType: "cryostorage_request",
      entityId: input.requestId,
      action: input.action,
      previousValue: input.previousValue ?? Prisma.JsonNull,
      newValue: input.newValue ?? Prisma.JsonNull,
      timestamp: new Date(),
    },
  });
}

export async function executeSubmitCryostorageRequestCommand(input: {
  actor: ResolvedActor;
  command: SubmitCryostorageRequestCommand;
} & CommandIdentity) {
  const command = {
    labId: input.command.labId.trim(),
    requestType: input.command.requestType,
    targetRecordId: normalizeOptional(input.command.targetRecordId),
    strainId: normalizeOptional(input.command.strainId),
    projectId: normalizeOptional(input.command.projectId),
    sampleLabel: normalizeOptional(input.command.sampleLabel),
    materialType: normalizeOptional(input.command.materialType),
    requestedQuantityLabel: normalizeOptional(input.command.requestedQuantityLabel),
    requestedStorageLocation: normalizeOptional(input.command.requestedStorageLocation),
    requestedFor: input.command.requestedFor.trim(),
    notes: normalizeOptional(input.command.notes),
  };
  const requestedFor = parseCalendarDate(command.requestedFor);
  if (!command.labId || !requestedFor || dateKey(requestedFor) < dateKey(new Date())) {
    return validationError("Choose an active lab and today or a future requested date.");
  }
  if ((command.notes?.length ?? 0) > 1000) return validationError("Request notes must be 1000 characters or fewer.");
  if ((command.requestedStorageLocation?.length ?? 0) > 160 || (command.requestedQuantityLabel?.length ?? 0) > 100) {
    return validationError("Keep the requested location and quantity within their field limits.");
  }
  if (command.requestType === "store") {
    if (
      command.targetRecordId
      || !command.strainId
      || !command.sampleLabel
      || command.sampleLabel.length < 3
      || command.sampleLabel.length > 80
      || !command.materialType
      || command.materialType.length < 2
      || command.materialType.length > 80
    ) {
      return validationError("Storage requests need a strain, unique label, material type, and requested date.");
    }
  } else if (!command.targetRecordId || command.strainId || command.projectId || command.sampleLabel || command.materialType) {
    return validationError("Recovery and discard requests must identify one existing cryostorage record.");
  }

  const cryostorageRequestId = `cryo-request-${canonicalJsonHash({
    actorId: input.actor.id,
    commandType: "cryostorage.request.submit",
    idempotencyKey: input.idempotencyKey.trim(),
  }).slice(0, 32)}`;

  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "cryostorage.request.submit",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command as Prisma.InputJsonValue,
    requiredCapability: "cryostorage:request",
    labId: command.labId,
    aggregateType: "cryostorage_request",
    aggregateId: cryostorageRequestId,
    handler: async (tx, context) => {
      const access = await getActorLabAccess(input.actor, tx);
      if (!canManageLab(access, command.labId)) {
        return { ok: false as const, code: "not_found", message: "Lab not found." };
      }
      const lab = await tx.lab.findUnique({ where: { id: command.labId }, select: { active: true } });
      if (!lab?.active) return { ok: false as const, code: "not_found", message: "Lab not found." };

      let targetRecordVersion: number | null = null;
      if (command.requestType === "store") {
        const [strain, project, duplicateRecord, duplicateRequest] = await Promise.all([
          tx.strain.findUnique({ where: { id: command.strainId! }, select: { id: true } }),
          command.projectId
            ? tx.project.findFirst({ where: { id: command.projectId, labId: command.labId }, select: { id: true } })
            : Promise.resolve(null),
          tx.cryostorageRecord.findUnique({ where: { sampleLabel: command.sampleLabel! }, select: { id: true } }),
          tx.cryostorageRequest.findFirst({
            where: { labId: command.labId, requestType: "store", sampleLabel: command.sampleLabel, status: "submitted" },
            select: { id: true },
          }),
        ]);
        if (!strain) return validationError("Choose a valid strain.");
        if (command.projectId && !project) return validationError("Choose a project owned by this lab.");
        if (duplicateRecord || duplicateRequest) return validationError("That cryostorage label is already recorded or awaiting storage.");
      } else {
        const [target, openRequest] = await Promise.all([
          tx.cryostorageRecord.findFirst({
            where: { id: command.targetRecordId!, labId: command.labId },
            select: { id: true, version: true, status: true },
          }),
          tx.cryostorageRequest.findFirst({
            where: { targetRecordId: command.targetRecordId, status: "submitted" },
            select: { id: true },
          }),
        ]);
        if (!target) return { ok: false as const, code: "not_found", message: "Cryostorage record not found." };
        const eligible = command.requestType === "recover"
          ? ["stored", "reserved"].includes(target.status)
          : ["stored", "reserved", "recovered"].includes(target.status);
        if (!eligible) return validationError(`This record cannot be ${command.requestType === "recover" ? "recovered" : "discarded"} from its current status.`);
        if (openRequest) return validationError("This cryostorage record already has an open request.");
        targetRecordVersion = target.version;
      }

      await bindCryostorageCommandContext(tx, {
        receiptId: context.receiptId,
        actorId: input.actor.id,
        commandType: "cryostorage.request.submit",
      });
      const request = await tx.cryostorageRequest.create({
        data: {
          id: cryostorageRequestId,
          labId: command.labId,
          requestType: command.requestType,
          targetRecordId: command.targetRecordId,
          targetRecordVersion,
          strainId: command.requestType === "store" ? command.strainId : null,
          projectId: command.requestType === "store" ? command.projectId : null,
          sampleLabel: command.requestType === "store" ? command.sampleLabel : null,
          materialType: command.requestType === "store" ? command.materialType : null,
          requestedQuantityLabel: command.requestedQuantityLabel,
          requestedStorageLocation: command.requestedStorageLocation,
          requestedFor,
          notes: command.notes,
          requestedById: input.actor.id,
        },
      });
      await Promise.all([
        writeCryostorageEvent(tx, {
          requestId: request.id,
          eventType: "submitted",
          actor: input.actor,
          metadata: { requestType: request.requestType, targetRecordId: request.targetRecordId },
        }),
        writeCryostorageAudit(tx, {
          requestId: request.id,
          actorId: input.actor.id,
          action: "submit",
          newValue: {
            labId: request.labId,
            requestType: request.requestType,
            targetRecordId: request.targetRecordId,
            targetRecordVersion: request.targetRecordVersion,
            sampleLabel: request.sampleLabel,
            requestedFor: command.requestedFor,
            version: request.version,
          },
        }),
      ]);
      return {
        ok: true as const,
        result: {
          requestId: request.id,
          version: request.version,
          message: `${request.requestType === "store" ? "Storage" : request.requestType === "recover" ? "Recovery" : "Discard"} request submitted.`,
        },
        aggregateType: "cryostorage_request",
        aggregateId: request.id,
        resultingVersion: request.version,
      };
    },
  });
}

export async function executeCancelCryostorageRequestCommand(input: {
  actor: ResolvedActor;
  command: { requestId: string; labId: string; reason: string };
  expectedVersion: number;
} & CommandIdentity) {
  const command = {
    requestId: input.command.requestId.trim(),
    labId: input.command.labId.trim(),
    reason: input.command.reason.trim(),
  };
  if (!command.requestId || !command.labId || command.reason.length < 3 || command.reason.length > 1000) {
    return validationError("Enter a cancellation reason of 3 to 1000 characters.");
  }

  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "cryostorage.request.cancel",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command, expectedVersion: input.expectedVersion },
    requiredCapability: "cryostorage:request",
    labId: command.labId,
    aggregateType: "cryostorage_request",
    aggregateId: command.requestId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      const [request, access] = await Promise.all([
        tx.cryostorageRequest.findFirst({ where: { id: command.requestId, labId: command.labId } }),
        getActorLabAccess(input.actor, tx),
      ]);
      if (!request) return { ok: false as const, code: "not_found", message: "Cryostorage request not found." };
      const membershipRole = access.membershipByLabId.get(request.labId);
      const mayCancel = request.requestedById === input.actor.id
        || access.canViewAll
        || membershipRole === "owner"
        || membershipRole === "manager";
      if (!mayCancel) return { ok: false as const, code: "not_found", message: "Cryostorage request not found." };
      if (request.status !== "submitted") return validationError("Only a submitted request can be cancelled.");

      const decidedAt = new Date();
      await bindCryostorageCommandContext(tx, {
        receiptId: context.receiptId,
        actorId: input.actor.id,
        commandType: "cryostorage.request.cancel",
      });
      const updated = await tx.cryostorageRequest.update({
        where: { id: request.id },
        data: {
          status: "cancelled",
          decidedById: input.actor.id,
          decidedAt,
          decisionReason: command.reason,
          version: { increment: 1 },
        },
      });
      await Promise.all([
        writeCryostorageEvent(tx, {
          requestId: request.id,
          eventType: "cancelled",
          actor: input.actor,
          reason: command.reason,
        }),
        writeCryostorageAudit(tx, {
          requestId: request.id,
          actorId: input.actor.id,
          action: "cancel",
          previousValue: { status: request.status, version: request.version },
          newValue: { status: updated.status, version: updated.version, reason: command.reason },
        }),
      ]);
      return {
        ok: true as const,
        result: { requestId: updated.id, version: updated.version, message: "Cryostorage request cancelled." },
        aggregateType: "cryostorage_request",
        aggregateId: updated.id,
        resultingVersion: updated.version,
      };
    },
  });
}

export async function executeCryostorageRequestCommand(input: {
  actor: ResolvedActor;
  command: ExecuteCryostorageRequestCommand;
  expectedVersion: number;
} & CommandIdentity) {
  const command = {
    requestId: input.command.requestId.trim(),
    labId: input.command.labId.trim(),
    action: input.command.action,
    performedAt: normalizeOptional(input.command.performedAt),
    resultingStatus: input.command.resultingStatus ?? null,
    storageLocation: normalizeOptional(input.command.storageLocation),
    quantityLabel: normalizeOptional(input.command.quantityLabel),
    reason: normalizeOptional(input.command.reason),
    operationNotes: normalizeOptional(input.command.operationNotes),
  };
  if (!command.requestId || !command.labId || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return validationError("Choose a valid cryostorage request.");
  }
  if ((command.reason?.length ?? 0) > 1000 || (command.operationNotes?.length ?? 0) > 1000) {
    return validationError("Reasons and operation notes must be 1000 characters or fewer.");
  }
  if ((command.storageLocation?.length ?? 0) > 160 || (command.quantityLabel?.length ?? 0) > 100) {
    return validationError("Keep storage location and quantity within their field limits.");
  }
  if (command.action === "reject" && (command.reason?.length ?? 0) < 3) {
    return validationError("Enter a clear rejection reason.");
  }
  const performedAt = command.action === "complete" ? parseCalendarDate(command.performedAt) : null;
  if (command.action === "complete" && (!performedAt || dateKey(performedAt) > dateKey(new Date()))) {
    return validationError("Choose today or an earlier operation date.");
  }

  return executeIdempotentCommand<CryostorageExecutionResult>({
    actor: input.actor,
    commandType: "cryostorage.request.execute",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command, expectedVersion: input.expectedVersion },
    requiredCapability: "cryostorage:manage",
    labId: command.labId,
    aggregateType: "cryostorage_request",
    aggregateId: command.requestId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      const request = await tx.cryostorageRequest.findFirst({
        where: { id: command.requestId, labId: command.labId },
        include: { targetRecord: true, strain: { select: { id: true } }, project: { select: { id: true } } },
      });
      if (!request) return { ok: false as const, code: "not_found", message: "Cryostorage request not found." };
      if (request.status !== "submitted") return validationError("This cryostorage request is no longer awaiting execution.");

      await bindCryostorageCommandContext(tx, {
        receiptId: context.receiptId,
        actorId: input.actor.id,
        commandType: "cryostorage.request.execute",
      });
      const decidedAt = new Date();
      if (command.action === "reject") {
        const updated = await tx.cryostorageRequest.update({
          where: { id: request.id },
          data: {
            status: "rejected",
            decidedById: input.actor.id,
            decidedAt,
            decisionReason: command.reason,
            version: { increment: 1 },
          },
        });
        await Promise.all([
          writeCryostorageEvent(tx, {
            requestId: request.id,
            eventType: "rejected",
            actor: input.actor,
            reason: command.reason,
          }),
          writeCryostorageAudit(tx, {
            requestId: request.id,
            actorId: input.actor.id,
            action: "reject",
            previousValue: { status: request.status, version: request.version },
            newValue: { status: updated.status, version: updated.version, reason: command.reason },
          }),
        ]);
        return {
          ok: true as const,
          result: { requestId: updated.id, version: updated.version, message: "Cryostorage request rejected." },
          aggregateType: "cryostorage_request",
          aggregateId: updated.id,
          resultingVersion: updated.version,
        };
      }

      if (!performedAt || performedAt < new Date(request.requestedAt.toISOString().slice(0, 10) + "T00:00:00.000Z")) {
        return validationError("Operation date cannot precede the request date.");
      }

      let record: {
        id: string;
        sampleLabel: string;
        status: CryostorageStatus;
        storageLocation: string | null;
        quantityLabel: string | null;
        version: number;
      };
      let previousStatus: CryostorageStatus | null = null;
      let resultingStatus: CryostorageStatus;

      if (request.requestType === "store") {
        if (!request.strainId || !request.sampleLabel || !request.materialType) {
          return validationError("This storage request is incomplete and cannot be executed.");
        }
        const duplicate = await tx.cryostorageRecord.findUnique({ where: { sampleLabel: request.sampleLabel }, select: { id: true } });
        if (duplicate) return validationError("That cryostorage label is already in inventory.");
        const storageLocation = command.storageLocation ?? request.requestedStorageLocation;
        if (!storageLocation || storageLocation.length < 2) return validationError("Enter the final storage location.");
        record = await tx.cryostorageRecord.create({
          data: {
            id: randomUUID(),
            labId: request.labId,
            strainId: request.strainId,
            projectId: request.projectId,
            sampleLabel: request.sampleLabel,
            materialType: request.materialType,
            status: "stored",
            storedAt: performedAt,
            storageLocation,
            quantityLabel: command.quantityLabel ?? request.requestedQuantityLabel,
            recoveryNotes: null,
            notes: request.notes,
            createdById: input.actor.id,
          },
          select: { id: true, sampleLabel: true, status: true, storageLocation: true, quantityLabel: true, version: true },
        });
        resultingStatus = "stored";
      } else {
        const target = request.targetRecord;
        if (!target || request.targetRecordVersion === null) {
          return validationError("The requested cryostorage record is no longer available.");
        }
        previousStatus = target.status;
        if (request.requestType === "recover") {
          if (!["stored", "reserved"].includes(target.status)) return validationError("This record is no longer recoverable.");
          if (!command.resultingStatus || !["recovered", "depleted"].includes(command.resultingStatus)) {
            return validationError("Choose whether recovery leaves the record recovered or depleted.");
          }
          resultingStatus = command.resultingStatus;
        } else {
          if (!["stored", "reserved", "recovered"].includes(target.status)) return validationError("This record can no longer be discarded.");
          resultingStatus = "discarded";
        }
        const updated = await tx.cryostorageRecord.updateMany({
          where: { id: target.id, labId: request.labId, version: request.targetRecordVersion },
          data: {
            status: resultingStatus,
            storageLocation: command.storageLocation ?? target.storageLocation,
            quantityLabel: command.quantityLabel ?? target.quantityLabel,
            recoveryNotes: command.operationNotes ?? target.recoveryNotes,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          return { ok: false as const, code: "stale_conflict", message: "The cryostorage record changed after this request was submitted." };
        }
        record = await tx.cryostorageRecord.findUniqueOrThrow({
          where: { id: target.id },
          select: { id: true, sampleLabel: true, status: true, storageLocation: true, quantityLabel: true, version: true },
        });
      }

      const updatedRequest = await tx.cryostorageRequest.update({
        where: { id: request.id },
        data: {
          status: "completed",
          decidedById: input.actor.id,
          decidedAt,
          decisionReason: command.reason,
          version: { increment: 1 },
        },
      });
      await tx.cryostorageOperation.create({
        data: {
          id: randomUUID(),
          requestId: request.id,
          recordId: record.id,
          labId: request.labId,
          operationType: request.requestType,
          previousStatus,
          resultingStatus,
          performedAt,
          performedById: input.actor.id,
          storageLocation: record.storageLocation,
          quantityLabel: record.quantityLabel,
          notes: command.operationNotes,
        },
      });
      await Promise.all([
        writeCryostorageEvent(tx, {
          requestId: request.id,
          eventType: "completed",
          actor: input.actor,
          reason: command.reason,
          metadata: {
            recordId: record.id,
            previousStatus,
            resultingStatus,
            performedAt: command.performedAt,
          },
        }),
        writeCryostorageAudit(tx, {
          requestId: request.id,
          actorId: input.actor.id,
          action: "complete",
          previousValue: {
            status: request.status,
            version: request.version,
            recordId: request.targetRecordId,
            recordVersion: request.targetRecordVersion,
            recordStatus: previousStatus,
          },
          newValue: {
            status: updatedRequest.status,
            version: updatedRequest.version,
            recordId: record.id,
            recordVersion: record.version,
            recordStatus: record.status,
          },
        }),
      ]);

      return {
        ok: true as const,
        result: {
          requestId: request.id,
          recordId: record.id,
          version: updatedRequest.version,
          message: `${record.sampleLabel} ${request.requestType === "store" ? "stored" : request.requestType === "recover" ? "recovery recorded" : "discarded"}.`,
        },
        aggregateType: "cryostorage_request",
        aggregateId: request.id,
        resultingVersion: updatedRequest.version,
      };
    },
  });
}
