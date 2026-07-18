import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { executeIdempotentCommand } from "@/lib/command-foundation";
import { canManageLab, getActorLabAccess } from "@/lib/lab-access";
import type { ResolvedActor } from "@/lib/session";

const RESPONSIBLE_MEMBERSHIP_ROLES = ["owner", "manager", "staff"] as const;

export async function bindCageAssignmentCommandContext(
  tx: Prisma.TransactionClient,
  input: {
    receiptId: string;
    actorId: string;
    commandType: "cage.responsibility.update" | "lab_transfer.finalize" | "cage.close";
  },
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT
      set_config('mcm.cage_assignment_receipt_id', ${input.receiptId}, true),
      set_config('mcm.cage_assignment_actor_id', ${input.actorId}, true),
      set_config('mcm.cage_assignment_command_type', ${input.commandType}, true)
  `);
}

export async function endActiveCageResponsibilities(
  tx: Prisma.TransactionClient,
  input: {
    cageId: string;
    labId: string;
    actorId: string;
    receiptId: string;
    commandType: "cage.responsibility.update" | "lab_transfer.finalize" | "cage.close";
    endedAt: Date;
    reason: string;
  },
) {
  await bindCageAssignmentCommandContext(tx, input);
  return tx.cageUserAssignment.updateMany({
    where: { cageId: input.cageId, labId: input.labId, endedAt: null },
    data: {
      endedAt: input.endedAt,
      endedById: input.actorId,
      endReason: input.reason.trim(),
      version: { increment: 1 },
    },
  });
}

export type SetCageResponsibilityCommand = {
  cageId: string;
  labId: string;
  responsibleUserIds: string[];
  reason: string;
};

function validationError(message: string) {
  return { ok: false as const, code: "validation_error", message };
}

export async function executeSetCageResponsibilityCommand(input: {
  actor: ResolvedActor;
  command: SetCageResponsibilityCommand;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
}) {
  const command = {
    cageId: input.command.cageId.trim(),
    labId: input.command.labId.trim(),
    responsibleUserIds: [...new Set(input.command.responsibleUserIds.map((userId) => userId.trim()).filter(Boolean))].sort(),
    reason: input.command.reason.trim(),
  };
  if (
    !command.cageId
    || !command.labId
    || command.reason.length < 3
    || command.reason.length > 500
    || !Number.isInteger(input.expectedVersion)
    || input.expectedVersion < 1
  ) {
    return validationError("Choose responsible lab members and enter a reason of 3 to 500 characters.");
  }

  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "cage.responsibility.update",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command, expectedVersion: input.expectedVersion },
    requiredCapability: "cages:manage",
    labId: command.labId,
    aggregateType: "cage",
    aggregateId: command.cageId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      const [cage, access, members, currentAssignments] = await Promise.all([
        tx.cage.findUnique({
          where: { id: command.cageId },
          select: { id: true, labId: true, active: true, status: true, version: true },
        }),
        getActorLabAccess(input.actor, tx),
        command.responsibleUserIds.length
          ? tx.labMembership.findMany({
              where: {
                labId: command.labId,
                userId: { in: command.responsibleUserIds },
                active: true,
                role: { in: [...RESPONSIBLE_MEMBERSHIP_ROLES] },
                user: { active: true },
                lab: { active: true },
              },
              select: { userId: true, user: { select: { name: true, email: true } } },
            })
          : Promise.resolve([]),
        tx.cageUserAssignment.findMany({
          where: { cageId: command.cageId, endedAt: null },
          orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
          select: { id: true, userId: true, assignedAt: true, user: { select: { name: true, email: true } } },
        }),
      ]);

      if (!cage || cage.labId !== command.labId || !canManageLab(access, command.labId)) {
        return { ok: false as const, code: "not_found", message: "Cage not found." };
      }
      if (!cage.active || cage.status === "closed") {
        return validationError("Closed or inactive cages cannot receive responsibility assignments.");
      }
      if (cage.version !== input.expectedVersion) {
        return { ok: false as const, code: "stale_conflict", message: "The cage changed. Refresh before updating responsibility." };
      }
      if (members.length !== command.responsibleUserIds.length) {
        return validationError("Every responsible user must be an active owner, manager, or staff member of this cage's lab.");
      }

      const currentUserIds = currentAssignments.map((assignment) => assignment.userId).sort();
      const currentUserIdSet = new Set(currentUserIds);
      const requestedUserIdSet = new Set(command.responsibleUserIds);
      const removedUserIds = currentUserIds.filter((userId) => !requestedUserIdSet.has(userId));
      const addedMembers = members.filter((member) => !currentUserIdSet.has(member.userId));
      if (!removedUserIds.length && !addedMembers.length) {
        return validationError("Responsibility is already assigned to the selected users.");
      }

      const changedAt = new Date();
      if (removedUserIds.length) {
        await bindCageAssignmentCommandContext(tx, {
          receiptId: context.receiptId,
          actorId: input.actor.id,
          commandType: "cage.responsibility.update",
        });
        await tx.cageUserAssignment.updateMany({
          where: { cageId: cage.id, userId: { in: removedUserIds }, endedAt: null },
          data: {
            endedAt: changedAt,
            endedById: input.actor.id,
            endReason: command.reason,
            version: { increment: 1 },
          },
        });
      }
      if (addedMembers.length) {
        await bindCageAssignmentCommandContext(tx, {
          receiptId: context.receiptId,
          actorId: input.actor.id,
          commandType: "cage.responsibility.update",
        });
        await tx.cageUserAssignment.createMany({
          data: addedMembers.map((member) => ({
            id: randomUUID(),
            cageId: cage.id,
            labId: cage.labId,
            userId: member.userId,
            assignedById: input.actor.id,
            assignedAt: changedAt,
            reason: command.reason,
          })),
        });
      }
      const cageUpdate = await tx.cage.updateMany({
        where: { id: cage.id, labId: cage.labId, version: input.expectedVersion },
        data: { lastUpdatedAt: changedAt, version: { increment: 1 } },
      });
      if (cageUpdate.count !== 1) {
        return { ok: false as const, code: "stale_conflict", message: "The cage changed while responsibility was being saved." };
      }

      const memberById = new Map(members.map((member) => [member.userId, member.user]));
      const currentById = new Map(currentAssignments.map((assignment) => [assignment.userId, assignment.user]));
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: input.actor.id,
          entityType: "cage",
          entityId: cage.id,
          action: "cage_responsibility_updated",
          previousValue: {
            labId: cage.labId,
            responsibleUsers: currentUserIds.map((userId) => ({ userId, ...currentById.get(userId) })),
          },
          newValue: {
            labId: cage.labId,
            reason: command.reason,
            responsibleUsers: command.responsibleUserIds.map((userId) => ({
              userId,
              ...(memberById.get(userId) ?? currentById.get(userId)),
            })),
          },
          timestamp: changedAt,
        },
      });

      return {
        ok: true as const,
        result: {
          cageId: cage.id,
          responsibleUserIds: command.responsibleUserIds,
          version: input.expectedVersion + 1,
          message: command.responsibleUserIds.length
            ? `Responsibility saved for ${command.responsibleUserIds.length} user${command.responsibleUserIds.length === 1 ? "" : "s"}.`
            : "Cage responsibility cleared.",
        } as Prisma.InputJsonValue,
        aggregateType: "cage",
        aggregateId: cage.id,
        resultingVersion: input.expectedVersion + 1,
      };
    },
  });
}
