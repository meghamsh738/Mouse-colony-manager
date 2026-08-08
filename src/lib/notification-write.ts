import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { normalizeUserRole } from "@/lib/capabilities";
import { canonicalJsonHash, executeIdempotentCommand, staleConflict } from "@/lib/command-foundation";
import { getNotificationDefinition, notificationDefinitions } from "@/lib/notification-catalog";
import { rescheduleNotificationDigestsInTransaction } from "@/lib/notification-materialization";
import type { ResolvedActor } from "@/lib/session";

export type NotificationRecipientAction = "read" | "acknowledge" | "resolve";
export type NotificationEmailModeInput = "off" | "daily_digest" | "weekly_digest";

function facilityRoleMatches(actor: ResolvedActor, role: string | null) {
  const canonicalRole = normalizeUserRole(actor.databaseRole);
  return role === canonicalRole;
}

async function recipientIsCurrent(
  tx: Prisma.TransactionClient,
  actor: ResolvedActor,
  recipient: {
    recipientAuthzVersion: number;
    recipientRole: string;
    recipientMembershipRole: string | null;
    labId: string | null;
    audience: {
      audienceType: string;
      userId: string | null;
      labId: string | null;
      facilityRole: string | null;
    };
  },
) {
  if (
    recipient.recipientAuthzVersion !== actor.authzVersion
    || recipient.recipientRole !== actor.databaseRole
  ) return false;

  if (recipient.audience.audienceType === "facility_role") {
    return recipient.recipientMembershipRole === null
      && facilityRoleMatches(actor, recipient.audience.facilityRole);
  }

  if (recipient.audience.audienceType === "user" && recipient.audience.userId !== actor.id) {
    return false;
  }

  const labId = recipient.labId;
  if (!labId || recipient.audience.labId !== labId && recipient.audience.audienceType === "lab_members") {
    return recipient.audience.audienceType === "user" && !labId && recipient.recipientMembershipRole === null;
  }
  const membership = await tx.labMembership.findFirst({
    where: { userId: actor.id, labId, active: true, lab: { active: true } },
    select: { role: true },
  });
  return Boolean(membership && membership.role === recipient.recipientMembershipRole);
}

export async function executeNotificationRecipientAction(input: {
  actor: ResolvedActor;
  recipientId: string;
  action: NotificationRecipientAction;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
}) {
  const recipientId = input.recipientId.trim();
  const request = { recipientId, action: input.action };
  if (
    !recipientId
    || !Number.isInteger(input.expectedVersion)
    || input.expectedVersion < 1
    || !["read", "acknowledge", "resolve"].includes(input.action)
  ) {
    return { ok: false as const, code: "validation_error", message: "Notification action details are invalid." };
  }

  return executeIdempotentCommand({
    actor: input.actor,
    commandType: `notification.recipient.${input.action}`,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request,
    requiredCapability: "notifications:read",
    aggregateType: "notification_recipient",
    aggregateId: recipientId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      const recipient = await tx.notificationRecipient.findFirst({
        where: {
          id: recipientId,
          userId: input.actor.id,
          status: "active",
          event: { status: { not: "resolved" } },
        },
        include: { audience: true },
      });
      if (!recipient || !await recipientIsCurrent(tx, input.actor, recipient)) {
        return { ok: false as const, code: "not_found", message: "Notification not found." };
      }

      const now = new Date();
      const before = {
        readAt: recipient.readAt?.toISOString() ?? null,
        acknowledgedAt: recipient.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: recipient.resolvedAt?.toISOString() ?? null,
        version: recipient.version,
      };
      const data = input.action === "read"
        ? { readAt: recipient.readAt ?? now }
        : input.action === "acknowledge"
          ? {
              readAt: recipient.readAt ?? now,
              acknowledgedAt: recipient.acknowledgedAt ?? now,
            }
          : {
              readAt: recipient.readAt ?? now,
              acknowledgedAt: recipient.acknowledgedAt ?? now,
              resolvedAt: recipient.resolvedAt ?? now,
            };
      const updated = await tx.notificationRecipient.update({
        where: { id: recipient.id },
        data: { ...data, version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: input.actor.id,
          entityType: "notification_recipient",
          entityId: recipient.id,
          action: input.action,
          previousValue: before,
          newValue: {
            readAt: updated.readAt?.toISOString() ?? null,
            acknowledgedAt: updated.acknowledgedAt?.toISOString() ?? null,
            resolvedAt: updated.resolvedAt?.toISOString() ?? null,
            version: updated.version,
          },
          timestamp: now,
        },
      });
      return {
        ok: true as const,
        result: {
          recipientId: recipient.id,
          action: input.action,
          version: updated.version,
          message: input.action === "read"
            ? "Notification marked as read."
            : input.action === "acknowledge"
              ? "Notification acknowledged."
              : "Notification resolved.",
        },
        aggregateType: "notification_recipient",
        aggregateId: recipient.id,
        resultingVersion: updated.version,
      };
    },
  });
}

export async function updateNotificationPreference(input: {
  actor: ResolvedActor;
  categoryKey: string;
  inAppEnabled: boolean;
  emailMode: NotificationEmailModeInput;
  digestHourUtc: number;
  digestDayOfWeek: number;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
}) {
  const definition = notificationDefinitions.find((candidate) => candidate.categoryKey === input.categoryKey);
  if (
    !definition
    || !["off", "daily_digest", "weekly_digest"].includes(input.emailMode)
    || !Number.isInteger(input.digestHourUtc)
    || input.digestHourUtc < 0
    || input.digestHourUtc > 23
    || !Number.isInteger(input.digestDayOfWeek)
    || input.digestDayOfWeek < 0
    || input.digestDayOfWeek > 6
    || !Number.isInteger(input.expectedVersion)
    || input.expectedVersion < 0
  ) {
    return { ok: false as const, code: "validation_error", message: "Notification preference details are invalid." };
  }
  if (!getNotificationDefinition(definition.alertTypes[0] ?? "")) {
    return { ok: false as const, code: "validation_error", message: "Notification category is not supported." };
  }
  if (definition.emailAllowed === false && input.emailMode !== "off") {
    return { ok: false as const, code: "validation_error", message: `${definition.categoryLabel} notifications stay in the app and cannot be sent by email.` };
  }

  const preferenceId = `notification-preference-${canonicalJsonHash({
    userId: input.actor.id,
    categoryKey: input.categoryKey,
  }).slice(0, 32)}`;
  const request = {
    categoryKey: input.categoryKey,
    inAppEnabled: input.inAppEnabled,
    emailMode: input.emailMode,
    digestHourUtc: input.digestHourUtc,
    digestDayOfWeek: input.digestDayOfWeek,
  };
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "notification.preference.update",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request,
    requiredCapability: "notifications:read",
    ...(input.expectedVersion > 0
      ? {
          aggregateType: "notification_preference" as const,
          aggregateId: preferenceId,
          expectedVersion: input.expectedVersion,
        }
      : {}),
    handler: async (tx) => {
      const current = await tx.notificationPreference.findUnique({ where: { id: preferenceId } });
      if (!current && input.expectedVersion !== 0) {
        const conflict = staleConflict("notification_preference", preferenceId, input.expectedVersion, null);
        return { ...conflict, result: conflict as unknown as Prisma.InputJsonValue };
      }
      if (current && current.userId !== input.actor.id) {
        return { ok: false as const, code: "not_found", message: "Notification preference not found." };
      }
      if (current && current.version !== input.expectedVersion) {
        const conflict = staleConflict("notification_preference", preferenceId, input.expectedVersion, current.version);
        return { ...conflict, result: conflict as unknown as Prisma.InputJsonValue };
      }

      const saved = current
        ? await tx.notificationPreference.update({
            where: { id: preferenceId },
            data: {
              ...request,
              version: { increment: 1 },
            },
          })
        : await tx.notificationPreference.create({
            data: {
              id: preferenceId,
              userId: input.actor.id,
              ...request,
            },
          });
      const scheduling = await rescheduleNotificationDigestsInTransaction(tx, {
        producerId: input.actor.id,
        userId: input.actor.id,
        categoryKey: input.categoryKey,
        preference: saved.emailMode === "off"
          ? null
          : {
              emailMode: saved.emailMode,
              digestHourUtc: saved.digestHourUtc,
              digestDayOfWeek: saved.digestDayOfWeek,
              version: saved.version,
            },
      });
      const now = new Date();
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: input.actor.id,
          entityType: "notification_preference",
          entityId: saved.id,
          action: current ? "update" : "create",
          previousValue: current ? {
            inAppEnabled: current.inAppEnabled,
            emailMode: current.emailMode,
            digestHourUtc: current.digestHourUtc,
            digestDayOfWeek: current.digestDayOfWeek,
            version: current.version,
          } : undefined,
          newValue: {
            ...request,
            version: saved.version,
            scheduling,
          },
          timestamp: now,
        },
      });
      return {
        ok: true as const,
        result: {
          preferenceId: saved.id,
          categoryKey: saved.categoryKey,
          version: saved.version,
          message: `${definition.categoryLabel} delivery preference saved.`,
          scheduling,
        },
        aggregateType: "notification_preference",
        aggregateId: saved.id,
        resultingVersion: saved.version,
      };
    },
  });
}
