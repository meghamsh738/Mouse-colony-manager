import { randomUUID } from "node:crypto";

import { Prisma, type LabMembershipRole, type UserRole } from "@prisma/client";

import { canonicalJsonHash, enqueueOutboxMessage } from "@/lib/command-foundation";
import {
  getNotificationDefinition,
  isUrgentNotification,
} from "@/lib/notification-catalog";
import { prisma } from "@/lib/prisma";
import { nextNotificationDigestAt } from "@/lib/notification-scheduling";
import type { Alert } from "@/lib/types";

type MaterializableAlert = Alert & { labId?: string | null };

type AudienceDraft = {
  audienceKey: string;
  audienceType: "user" | "lab_members" | "facility_role";
  userId?: string;
  labId?: string;
  facilityRole?: "facility_admin" | "cmu_staff";
};

type RecipientCandidate = {
  audienceId: string;
  priority: number;
  userId: string;
  authzVersion: number;
  role: UserRole;
  membershipRole: LabMembershipRole | null;
};

type DeliveryPreference = {
  emailMode: "daily_digest" | "weekly_digest";
  digestHourUtc: number;
  digestDayOfWeek: number;
  version: number;
};

const FACILITY_ROLE_VARIANTS = {
  facility_admin: ["facility_admin", "admin"],
  cmu_staff: ["cmu_staff", "colony_manager"],
} as const satisfies Record<"facility_admin" | "cmu_staff", readonly UserRole[]>;

function sourceKey(alert: Pick<MaterializableAlert, "id" | "labId" | "source">) {
  const namespace = alert.source === "billing" ? "billing-event" : "dashboard-alert";
  return `${namespace}:${alert.labId ?? "facility"}:${alert.id}`;
}

function eventIdForSource(key: string) {
  return `notification-${canonicalJsonHash(key).slice(0, 36)}`;
}

function desiredAudiences(alert: MaterializableAlert): AudienceDraft[] {
  const audiences: AudienceDraft[] = [];
  const definition = getNotificationDefinition(alert.alertType);
  if (alert.labId) {
    audiences.push({
      audienceType: "lab_members",
      audienceKey: `lab:${alert.labId}`,
      labId: alert.labId,
    });
  }
  if (definition?.audiencePolicy === "lab_members_only") return audiences;
  audiences.push({
    audienceType: "facility_role",
    audienceKey: "role:facility_admin",
    facilityRole: "facility_admin",
  });
  audiences.push({
    audienceType: "facility_role",
    audienceKey: "role:cmu_staff",
    facilityRole: "cmu_staff",
  });
  return audiences;
}

function pickCandidate(
  candidates: Map<string, RecipientCandidate>,
  candidate: RecipientCandidate,
) {
  const current = candidates.get(candidate.userId);
  if (!current || candidate.priority < current.priority) candidates.set(candidate.userId, candidate);
}

async function enqueueRecipientDelivery(
  tx: Prisma.TransactionClient,
  input: {
    producer: { id: string; authzVersion: number };
    recipient: { id: string; userId: string; version: number };
    event: { id: string; labId: string | null; urgent: boolean; version: number };
    preference: DeliveryPreference | null;
    now: Date;
  },
) {
  if (!input.event.urgent && !input.preference) return null;
  const kind = input.event.urgent ? "immediate" as const : "digest" as const;
  const preferenceVersion = input.event.urgent ? 0 : input.preference!.version;
  const scheduledFor = input.event.urgent
    ? input.now
    : nextNotificationDigestAt({
        now: input.now,
        mode: input.preference!.emailMode,
        hourUtc: input.preference!.digestHourUtc,
        dayOfWeek: input.preference!.digestDayOfWeek,
      });
  const existingDelivery = await tx.notificationDelivery.findUnique({
    where: {
      recipientId_kind_preferenceVersion_eventVersion: {
        recipientId: input.recipient.id,
        kind,
        preferenceVersion,
        eventVersion: input.event.version,
      },
    },
    select: { id: true },
  });
  if (existingDelivery) return existingDelivery.id;
  const deliveryId = randomUUID();
  const outbox = await enqueueOutboxMessage(tx, {
    topic: input.event.urgent ? "notifications.email" : "notifications.digest",
    aggregateType: "notification_delivery",
    aggregateId: deliveryId,
    actor: input.producer,
    labId: input.event.labId,
    payload: {
      deliveryId,
      recipientId: input.recipient.id,
      recipientVersion: input.recipient.version,
      preferenceVersion,
      eventId: input.event.id,
      eventVersion: input.event.version,
    },
    dedupeKey: `notification-delivery:${deliveryId}`,
    availableAt: scheduledFor,
  });
  await tx.notificationDelivery.create({
    data: {
      id: deliveryId,
      recipientId: input.recipient.id,
      recipientVersion: input.recipient.version,
      preferenceVersion,
      eventVersion: input.event.version,
      outboxMessageId: outbox.id,
      kind,
      scheduledFor,
    },
  });
  return deliveryId;
}

async function collectAudienceCandidates(
  tx: Prisma.TransactionClient,
  audiences: Array<{
    id: string;
    audienceType: "user" | "lab_members" | "facility_role";
    userId: string | null;
    labId: string | null;
    facilityRole: UserRole | null;
  }>,
) {
  const candidates = new Map<string, RecipientCandidate>();

  for (const audience of audiences) {
    if (audience.audienceType === "user" && audience.userId) {
      const user = await tx.user.findFirst({
        where: { id: audience.userId, active: true },
        select: { id: true, authzVersion: true, role: true },
      });
      if (user) {
        pickCandidate(candidates, {
          audienceId: audience.id,
          priority: 0,
          userId: user.id,
          authzVersion: user.authzVersion,
          role: user.role,
          membershipRole: null,
        });
      }
      continue;
    }

    if (audience.audienceType === "lab_members" && audience.labId) {
      const memberships = await tx.labMembership.findMany({
        where: {
          labId: audience.labId,
          active: true,
          lab: { active: true },
          user: { active: true },
        },
        select: {
          role: true,
          user: { select: { id: true, authzVersion: true, role: true } },
        },
      });
      for (const membership of memberships) {
        pickCandidate(candidates, {
          audienceId: audience.id,
          priority: 2,
          userId: membership.user.id,
          authzVersion: membership.user.authzVersion,
          role: membership.user.role,
          membershipRole: membership.role,
        });
      }
      continue;
    }

    if (audience.audienceType === "facility_role" && (
      audience.facilityRole === "facility_admin" || audience.facilityRole === "cmu_staff"
    )) {
      const users = await tx.user.findMany({
        where: {
          active: true,
          role: { in: [...FACILITY_ROLE_VARIANTS[audience.facilityRole]] },
        },
        select: { id: true, authzVersion: true, role: true },
      });
      for (const user of users) {
        pickCandidate(candidates, {
          audienceId: audience.id,
          priority: 1,
          userId: user.id,
          authzVersion: user.authzVersion,
          role: user.role,
          membershipRole: null,
        });
      }
    }
  }

  return candidates;
}

async function upsertNotificationEvent(
  tx: Prisma.TransactionClient,
  alert: MaterializableAlert,
  producerId: string,
) {
  const definition = getNotificationDefinition(alert.alertType);
  if (!definition) return null;
  if (alert.labId && alert.entityType === "cage") {
    const cage = await tx.cage.findUnique({ where: { id: alert.entityId }, select: { labId: true } });
    if (cage?.labId && cage.labId !== alert.labId) return null;
  }
  if (alert.labId && alert.entityType === "animal") {
    const animal = await tx.animal.findUnique({ where: { id: alert.entityId }, select: { owningLabId: true } });
    if (animal?.owningLabId && animal.owningLabId !== alert.labId) return null;
  }
  const key = sourceKey(alert);
  const occurredAt = new Date(alert.generatedAt);
  if (Number.isNaN(occurredAt.valueOf())) return null;
  const urgent = isUrgentNotification(alert);
  const existing = await tx.notificationEvent.findUnique({ where: { sourceKey: key } });

  let event = existing;
  if (!event) {
    event = await tx.notificationEvent.create({
      data: {
        id: eventIdForSource(key),
        sourceKey: key,
        source: alert.source,
        labId: alert.labId ?? null,
        categoryKey: definition.categoryKey,
        severity: alert.severity,
        message: alert.message,
        entityType: alert.entityType,
        entityId: alert.entityId,
        deepLink: definition.hrefForAlert(alert),
        actionLabel: definition.actionLabelForAlert(alert),
        urgent,
        status: alert.status,
        occurredAt,
        resolvedAt: alert.status === "resolved" ? new Date(alert.resolvedAt ?? alert.generatedAt) : null,
      },
    });
  } else {
    const next = {
      severity: alert.severity,
      message: alert.message,
      deepLink: definition.hrefForAlert(alert),
      actionLabel: definition.actionLabelForAlert(alert),
      urgent,
      status: alert.status,
      resolvedAt: alert.status === "resolved" ? new Date(alert.resolvedAt ?? alert.generatedAt) : null,
    };
    if (
      event.severity !== next.severity
      || event.message !== next.message
      || event.deepLink !== next.deepLink
      || event.actionLabel !== next.actionLabel
      || event.urgent !== next.urgent
      || event.status !== next.status
      || event.resolvedAt?.toISOString() !== next.resolvedAt?.toISOString()
    ) {
      event = await tx.notificationEvent.update({
        where: { id: event.id },
        data: { ...next, version: { increment: 1 } },
      });
    }
  }

  const drafts = desiredAudiences(alert);
  await tx.notificationAudience.createMany({
    data: drafts.map((audience) => ({
      id: randomUUID(),
      eventId: event.id,
      ...audience,
    })),
    skipDuplicates: true,
  });
  const audiences = await tx.notificationAudience.findMany({ where: { eventId: event.id } });
  const candidates = await collectAudienceCandidates(tx, audiences);
  const existingRecipients = await tx.notificationRecipient.findMany({ where: { eventId: event.id } });
  const existingByUser = new Map(
    existingRecipients
      .filter((recipient) => recipient.status === "active")
      .map((recipient) => [recipient.userId, recipient]),
  );

  for (const candidate of candidates.values()) {
    const recipient = existingByUser.get(candidate.userId);
    if (!recipient) {
      await tx.notificationRecipient.create({
        data: {
          id: randomUUID(),
          eventId: event.id,
          audienceId: candidate.audienceId,
          userId: candidate.userId,
          labId: event.labId,
          recipientAuthzVersion: candidate.authzVersion,
          recipientRole: candidate.role,
          recipientMembershipRole: candidate.membershipRole,
        },
      });
      continue;
    }
    if (
      recipient.audienceId !== candidate.audienceId
      || recipient.recipientAuthzVersion !== candidate.authzVersion
      || recipient.recipientRole !== candidate.role
      || recipient.recipientMembershipRole !== candidate.membershipRole
    ) {
      await tx.notificationRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "revoked",
          revokedAt: new Date(),
          revokeReason: "Recipient authorization changed; a new materialized recipient preserves the prior history.",
          version: { increment: 1 },
        },
      });
      await tx.notificationRecipient.create({
        data: {
          id: randomUUID(),
          eventId: event.id,
          audienceId: candidate.audienceId,
          userId: candidate.userId,
          labId: event.labId,
          recipientAuthzVersion: candidate.authzVersion,
          recipientRole: candidate.role,
          recipientMembershipRole: candidate.membershipRole,
        },
      });
    }
  }

  const revokedAt = new Date();
  for (const recipient of existingRecipients) {
    if (recipient.status === "active" && !candidates.has(recipient.userId)) {
      await tx.notificationRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "revoked",
          revokedAt,
          revokeReason: "Recipient no longer belongs to an active notification audience.",
          version: { increment: 1 },
        },
      });
    }
  }

  const producer = await tx.user.findFirst({
    where: { id: producerId, active: true },
    select: { id: true, authzVersion: true },
  });
  if (producer && definition.emailAllowed !== false) {
    const activeRecipients = await tx.notificationRecipient.findMany({
      where: { eventId: event.id, status: "active" },
      select: { id: true, userId: true, version: true },
    });
    const preferences = event.urgent
      ? []
      : await tx.notificationPreference.findMany({
          where: {
            userId: { in: activeRecipients.map((recipient) => recipient.userId) },
            categoryKey: event.categoryKey,
            emailMode: { not: "off" },
          },
          select: {
            userId: true,
            emailMode: true,
            digestHourUtc: true,
            digestDayOfWeek: true,
            version: true,
          },
        });
    const preferenceByUser = new Map(preferences.map((preference) => [preference.userId, preference]));
    const now = new Date();
    for (const recipient of activeRecipients) {
      const preference = preferenceByUser.get(recipient.userId);
      if (!event.urgent && (!preference || preference.emailMode === "off")) continue;
      await enqueueRecipientDelivery(tx, {
        producer,
        recipient,
        event,
        preference: event.urgent ? null : preference as DeliveryPreference,
        now,
      });
    }
  }

  return event.sourceKey;
}

export async function materializeNotificationAlertInTransaction(
  tx: Prisma.TransactionClient,
  alert: MaterializableAlert,
  producerId: string,
) {
  return upsertNotificationEvent(tx, alert, producerId);
}

export async function rescheduleNotificationDigestsInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    producerId: string;
    userId: string;
    categoryKey: string;
    preference: DeliveryPreference | null;
  },
) {
  const producer = await tx.user.findFirst({
    where: { id: input.producerId, active: true },
    select: { id: true, authzVersion: true },
  });
  if (!producer) return { cancelled: 0, scheduled: 0 };

  const queued = await tx.notificationDelivery.findMany({
    where: {
      kind: "digest",
      status: "queued",
      recipient: { userId: input.userId, event: { categoryKey: input.categoryKey } },
    },
    select: { id: true, outboxMessageId: true },
  });
  const now = new Date();
  for (const delivery of queued) {
    const reason = "The recipient changed this category's email digest preference.";
    await tx.outboxDeliveryAttempt.updateMany({
      where: { messageId: delivery.outboxMessageId, status: "processing" },
      data: { status: "failed", completedAt: now, errorMessage: reason },
    });
    await tx.outboxMessage.updateMany({
      where: {
        id: delivery.outboxMessageId,
        status: { in: ["pending", "retry", "leased"] },
      },
      data: {
        status: "cancelled",
        leaseOwner: null,
        leaseToken: null,
        workerType: null,
        leasedAt: null,
        leaseExpiresAt: null,
        lastError: reason,
      },
    });
    await tx.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "cancelled",
        cancelledAt: now,
        lastError: reason,
        version: { increment: 1 },
      },
    });
  }

  if (!input.preference) return { cancelled: queued.length, scheduled: 0 };
  const recipients = await tx.notificationRecipient.findMany({
    where: {
      userId: input.userId,
      status: "active",
      resolvedAt: null,
      event: { categoryKey: input.categoryKey, urgent: false, status: { not: "resolved" } },
    },
    select: {
      id: true,
      userId: true,
      version: true,
      event: { select: { id: true, labId: true, urgent: true, version: true } },
    },
  });
  let scheduled = 0;
  for (const recipient of recipients) {
    const deliveryId = await enqueueRecipientDelivery(tx, {
      producer,
      recipient,
      event: recipient.event,
      preference: input.preference,
      now,
    });
    if (deliveryId) scheduled += 1;
  }
  return { cancelled: queued.length, scheduled };
}

export async function resolveNotificationsForOwnershipChangeInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    sourceLabId: string;
    cageIds?: string[];
    animalIds?: string[];
    resolvedAt: Date;
  },
) {
  const entityFilters = [
    ...(input.cageIds?.length ? [{ entityType: "cage", entityId: { in: input.cageIds } }] : []),
    ...(input.animalIds?.length ? [{ entityType: "animal", entityId: { in: input.animalIds } }] : []),
  ];
  if (!entityFilters.length) return { alertCount: 0, eventCount: 0, deliveryCount: 0 };
  const resolvedAlerts = await tx.alert.updateMany({
    where: {
      labId: input.sourceLabId,
      status: "open",
      OR: entityFilters,
    },
    data: {
      status: "resolved",
      resolvedAt: input.resolvedAt,
    },
  });
  const events = await tx.notificationEvent.findMany({
    where: {
      labId: input.sourceLabId,
      status: { not: "resolved" },
      OR: entityFilters,
    },
    select: {
      id: true,
      recipients: {
        select: {
          deliveries: {
            where: { status: "queued" },
            select: { id: true, outboxMessageId: true },
          },
        },
      },
    },
  });
  if (events.length) {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "NotificationEvent"
      WHERE id IN (${Prisma.join(events.map((event) => event.id))})
      ORDER BY id
      FOR UPDATE
    `);
  }
  const deliveries = events.flatMap((event) => event.recipients.flatMap((recipient) => recipient.deliveries));
  const reason = "Owning lab changed before notification delivery completed.";
  for (const delivery of deliveries) {
    await tx.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "cancelled",
        cancelledAt: input.resolvedAt,
        lastError: reason,
        version: { increment: 1 },
      },
    });
    await tx.outboxDeliveryAttempt.updateMany({
      where: { messageId: delivery.outboxMessageId, status: "processing" },
      data: { status: "failed", completedAt: input.resolvedAt, errorMessage: reason },
    });
    await tx.outboxMessage.updateMany({
      where: { id: delivery.outboxMessageId, status: { in: ["pending", "retry", "leased"] } },
      data: {
        status: "cancelled",
        leaseOwner: null,
        leaseToken: null,
        workerType: null,
        leasedAt: null,
        leaseExpiresAt: null,
        lastError: reason,
      },
    });
  }
  for (const event of events) {
    await tx.notificationEvent.update({
      where: { id: event.id },
      data: { status: "resolved", resolvedAt: input.resolvedAt, version: { increment: 1 } },
    });
  }
  return { alertCount: resolvedAlerts.count, eventCount: events.length, deliveryCount: deliveries.length };
}

function isRetryable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export async function materializeDashboardNotifications(input: {
  alerts: MaterializableAlert[];
  scopeLabIds: string[];
  includeGlobal: boolean;
  producerId: string;
  resolveMissing?: boolean;
}) {
  const materializable = input.alerts.filter((alert) => getNotificationDefinition(alert.alertType));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const currentSourceKeys = new Set<string>();
        for (const alert of materializable) {
          const key = await upsertNotificationEvent(tx, alert, input.producerId);
          if (key) currentSourceKeys.add(key);
        }

        if (input.resolveMissing !== false) {
          const scopeLabIds = input.includeGlobal
            ? (await tx.lab.findMany({ where: { active: true }, select: { id: true } })).map((lab) => lab.id)
            : input.scopeLabIds;
          const scopedEvents = await tx.notificationEvent.findMany({
            where: {
              sourceKey: { startsWith: "dashboard-alert:" },
              status: { not: "resolved" },
              OR: [
                ...(scopeLabIds.length ? [{ labId: { in: scopeLabIds } }] : []),
                ...(input.includeGlobal ? [{ labId: null }] : []),
              ],
            },
            select: { id: true, sourceKey: true },
          });
          const resolvedAt = new Date();
          for (const event of scopedEvents) {
            if (!currentSourceKeys.has(event.sourceKey)) {
              await tx.notificationEvent.update({
                where: { id: event.id },
                data: { status: "resolved", resolvedAt, version: { increment: 1 } },
              });
            }
          }
        }

        return { eventCount: materializable.length };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
    } catch (error) {
      if (attempt < 2 && isRetryable(error)) continue;
      throw error;
    }
  }
  throw new Error("Notification materialization could not be completed.");
}
