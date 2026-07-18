import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { materializeDashboardNotifications } from "../src/lib/notification-materialization";
import {
  authenticateOutboxWorker,
  claimOutboxMessages,
  completeOutboxMessage,
} from "../src/lib/command-foundation";
import { executeNotificationRecipientAction, updateNotificationPreference } from "../src/lib/notification-write";
import { getNotificationInboxView } from "../src/lib/notifications-read";
import type { ResolvedActor } from "../src/lib/session";
import { assertRetainedVerificationTarget } from "./retained-verification-guard";

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${process.pid}`;
const ids = {
  labA: `notification-lab-a-${suffix}`,
  labB: `notification-lab-b-${suffix}`,
  staffA: `notification-staff-a-${suffix}`,
  staffB: `notification-staff-b-${suffix}`,
  admin: `notification-admin-${suffix}`,
  cmu: `notification-cmu-${suffix}`,
  alert: `notification-alert-${suffix}`,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function labActor(userId: string, labId: string, email: string): ResolvedActor {
  return {
    id: userId,
    email,
    name: "Notification verifier",
    role: "animal_staff",
    databaseRole: "animal_staff",
    canonicalRole: "lab_user",
    authzVersion: 1,
    activeLabId: labId,
    activeMembership: { labId, labName: "Verifier lab", labCode: "VERIFY", role: "staff" },
    memberships: [{ labId, labName: "Verifier lab", labCode: "VERIFY", role: "staff" }],
    capabilities: ["notifications:read"],
  };
}

async function expectRejected(label: string, operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(`${label} was expected to be rejected.`);
}

async function main() {
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");
  assertRetainedVerificationTarget(databaseUrl);
  await prisma.lab.createMany({
    data: [
      { id: ids.labA, code: `NA${suffix}`.slice(0, 32), name: "Notification Lab A" },
      { id: ids.labB, code: `NB${suffix}`.slice(0, 32), name: "Notification Lab B" },
    ],
  });
  await prisma.user.createMany({
    data: [
      { id: ids.staffA, email: `staff-a-${suffix}@example.test`, name: "Staff A", passwordHash: "not-used", role: "animal_staff" },
      { id: ids.staffB, email: `staff-b-${suffix}@example.test`, name: "Staff B", passwordHash: "not-used", role: "animal_staff" },
      { id: ids.admin, email: `admin-${suffix}@example.test`, name: "Admin", passwordHash: "not-used", role: "admin" },
      { id: ids.cmu, email: `cmu-${suffix}@example.test`, name: "CMU", passwordHash: "not-used", role: "colony_manager" },
    ],
  });
  await prisma.labMembership.createMany({
    data: [
      { id: randomUUID(), labId: ids.labA, userId: ids.staffA, role: "staff" },
      { id: randomUUID(), labId: ids.labB, userId: ids.staffB, role: "staff" },
      { id: randomUUID(), labId: ids.labA, userId: ids.admin, role: "viewer" },
      { id: randomUUID(), labId: ids.labA, userId: ids.cmu, role: "staff" },
    ],
  });
  const alert = {
    id: ids.alert,
    labId: ids.labA,
    entityType: "cage" as const,
    entityId: `cage-${suffix}`,
    alertType: "welfare_note",
    severity: "critical" as const,
    message: "Urgent welfare verification",
    source: "manual" as const,
    status: "open" as const,
    generatedAt: new Date().toISOString(),
  };
  await prisma.alert.create({ data: { ...alert, generatedAt: new Date(alert.generatedAt) } });
  await materializeDashboardNotifications({
    alerts: [alert],
    scopeLabIds: [ids.labA],
    includeGlobal: false,
    producerId: ids.staffA,
    resolveMissing: false,
  });

  const event = await prisma.notificationEvent.findUniqueOrThrow({
    where: { sourceKey: `dashboard-alert:${ids.labA}:${ids.alert}` },
    include: { audiences: true, recipients: { include: { audience: true } } },
  });
  const recipientUserIds = new Set(event.recipients.map((recipient) => recipient.userId));
  assert(event.urgent, "Critical welfare event was not marked urgent.");
  assert(recipientUserIds.has(ids.staffA), "Owning-lab staff recipient is missing.");
  assert(recipientUserIds.has(ids.admin), "Facility Admin recipient is missing.");
  assert(recipientUserIds.has(ids.cmu), "CMU recipient is missing.");
  assert(!recipientUserIds.has(ids.staffB), "Foreign-lab staff received the notification.");
  assert(
    event.recipients
      .filter((recipient) => recipient.userId === ids.admin || recipient.userId === ids.cmu)
      .every((recipient) => recipient.audience.audienceType === "facility_role" && recipient.recipientMembershipRole === null),
    "Facility actors with lab memberships were not materialized through their facility-role audience.",
  );
  assert(
    await prisma.notificationDelivery.count({ where: { recipient: { eventId: event.id }, kind: "immediate", status: "queued" } })
      === event.recipients.length,
    "Urgent welfare event did not queue one immediate email per exact recipient.",
  );

  await materializeDashboardNotifications({
    alerts: [{ ...alert, labId: ids.labB, message: "Destination-lab welfare verification" }],
    scopeLabIds: [ids.labB],
    includeGlobal: false,
    producerId: ids.staffB,
    resolveMissing: false,
  });
  const destinationEvent = await prisma.notificationEvent.findUniqueOrThrow({
    where: { sourceKey: `dashboard-alert:${ids.labB}:${ids.alert}` },
    include: { recipients: true },
  });
  assert(destinationEvent.id !== event.id, "Same source ID in a new lab reused the former lab event.");
  assert(
    destinationEvent.recipients.some((candidate) => candidate.userId === ids.staffB)
      && destinationEvent.recipients.every((candidate) => candidate.userId !== ids.staffA),
    "Lab-bound event identity mixed source and destination lab recipients.",
  );

  const workerToken = "retained-notification-worker-token-000000000001";
  process.env.OUTBOX_WORKER_TOKEN_NOTIFICATION_DELIVERY = workerToken;
  const worker = authenticateOutboxWorker({
    workerId: `notification-verifier-${suffix}`,
    workerType: "notification_delivery",
    token: workerToken,
  });
  assert(worker, "Notification worker authentication failed.");
  const claimed = await claimOutboxMessages({ worker, limit: 25 });
  const adminDelivery = await prisma.notificationDelivery.findFirstOrThrow({
    where: { recipient: { eventId: event.id, userId: ids.admin } },
  });
  const adminMessage = claimed.find((message) => message.id === adminDelivery.outboxMessageId);
  assert(adminMessage?.leaseToken, "Exact admin urgent delivery was not claimed.");
  assert(
    !await completeOutboxMessage({
      messageId: adminMessage.id,
      worker,
      leaseToken: adminMessage.leaseToken,
      deliveredTo: "wrong-recipient@example.test",
      providerStatus: 202,
    }),
    "Delivery completion accepted the wrong recipient email.",
  );
  assert(await completeOutboxMessage({
    messageId: adminMessage.id,
    worker,
    leaseToken: adminMessage.leaseToken,
    deliveredTo: `admin-${suffix}@example.test`,
    providerMessageId: `provider-${suffix}`,
    providerStatus: 202,
  }), "Exact-recipient urgent delivery could not complete.");
  const deliveredAdmin = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: adminDelivery.id } });
  assert(
    deliveredAdmin.status === "delivered"
      && deliveredAdmin.deliveredTo === `admin-${suffix}@example.test`
      && deliveredAdmin.attemptCount === 1,
    "Completed urgent delivery did not preserve recipient and attempt history.",
  );

  const actorA = labActor(ids.staffA, ids.labA, `staff-a-${suffix}@example.test`);
  const preferenceResult = await updateNotificationPreference({
    actor: actorA,
    categoryKey: "weaning_due",
    inAppEnabled: true,
    emailMode: "daily_digest",
    digestHourUtc: 8,
    digestDayOfWeek: 1,
    expectedVersion: 0,
    idempotencyKey: `notification-preference-${suffix}`,
    requestId: `notification-preference-request-${suffix}`,
  });
  assert(preferenceResult.ok, "Lab recipient could not enable a personal routine digest.");
  const routineAlert = {
    ...alert,
    id: `${ids.alert}-routine`,
    alertType: "weaning_due",
    severity: "warning" as const,
    message: "Routine weaning verification",
    entityType: "litter" as const,
    entityId: `litter-${suffix}`,
  };
  await materializeDashboardNotifications({
    alerts: [routineAlert],
    scopeLabIds: [ids.labA],
    includeGlobal: false,
    producerId: ids.staffA,
    resolveMissing: false,
  });
  const routineEvent = await prisma.notificationEvent.findUniqueOrThrow({
    where: { sourceKey: `dashboard-alert:${ids.labA}:${routineAlert.id}` },
  });
  const routineDeliveries = await prisma.notificationDelivery.findMany({
    where: { recipient: { eventId: routineEvent.id } },
    include: { recipient: { select: { userId: true } } },
  });
  assert(
    routineDeliveries.length === 1
      && routineDeliveries[0]?.recipient.userId === ids.staffA
      && routineDeliveries[0]?.kind === "digest",
    "Routine notification ignored the exact recipient's opt-in digest preference.",
  );
  const preference = await prisma.notificationPreference.findUniqueOrThrow({
    where: { userId_categoryKey: { userId: ids.staffA, categoryKey: "weaning_due" } },
  });
  const mutedResult = await updateNotificationPreference({
    actor: actorA,
    categoryKey: "weaning_due",
    inAppEnabled: true,
    emailMode: "off",
    digestHourUtc: 8,
    digestDayOfWeek: 1,
    expectedVersion: preference.version,
    idempotencyKey: `notification-preference-off-${suffix}`,
    requestId: `notification-preference-off-request-${suffix}`,
  });
  assert(mutedResult.ok, "Lab recipient could not disable a personal routine digest.");
  const cancelledRoutine = await prisma.notificationDelivery.findUniqueOrThrow({
    where: { id: routineDeliveries[0]!.id },
    include: { outboxMessage: true },
  });
  assert(
    cancelledRoutine.status === "cancelled" && cancelledRoutine.outboxMessage.status === "cancelled",
    "Disabling a routine digest did not cancel the exact queued delivery and outbox job.",
  );

  const recipient = event.recipients.find((candidate) => candidate.userId === ids.staffA);
  assert(recipient, "Owning-lab recipient row is missing.");
  const readResult = await executeNotificationRecipientAction({
    actor: actorA,
    recipientId: recipient.id,
    action: "read",
    expectedVersion: recipient.version,
    idempotencyKey: `notification-read-${suffix}`,
    requestId: `notification-read-request-${suffix}`,
  });
  assert(readResult.ok, "Authorized recipient could not mark the notification read.");
  const readRow = await prisma.notificationRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
  assert(readRow.readAt && readRow.version === recipient.version + 1, "Read action did not advance state and version.");
  assert(
    await prisma.auditLog.count({ where: { entityType: "notification_recipient", entityId: recipient.id, action: "read" } }) === 1,
    "Read action did not write its audit entry.",
  );
  await materializeDashboardNotifications({
    alerts: [alert],
    scopeLabIds: [ids.labA],
    includeGlobal: false,
    producerId: ids.staffA,
    resolveMissing: false,
  });
  assert(
    await prisma.notificationDelivery.count({ where: { recipientId: recipient.id, kind: "immediate" } }) === 1,
    "Reading an urgent notification created a duplicate delivery generation.",
  );

  const staleResult = await executeNotificationRecipientAction({
    actor: actorA,
    recipientId: recipient.id,
    action: "acknowledge",
    expectedVersion: recipient.version,
    idempotencyKey: `notification-stale-${suffix}`,
    requestId: `notification-stale-request-${suffix}`,
  });
  assert(!staleResult.ok && staleResult.code === "stale_conflict", "Stale recipient action was not rejected.");

  const actorB = labActor(ids.staffB, ids.labB, `staff-b-${suffix}@example.test`);
  const foreignResult = await executeNotificationRecipientAction({
    actor: actorB,
    recipientId: recipient.id,
    action: "read",
    expectedVersion: readRow.version,
    idempotencyKey: `notification-foreign-${suffix}`,
    requestId: `notification-foreign-request-${suffix}`,
  });
  assert(!foreignResult.ok && foreignResult.code === "not_found", "Foreign user could act on another recipient row.");

  const labAudience = event.audiences.find((audience) => audience.audienceType === "lab_members");
  assert(labAudience, "Lab audience is missing.");
  await expectRejected("invalid cross-lab recipient insert", () => prisma.notificationRecipient.create({
    data: {
      id: randomUUID(),
      eventId: event.id,
      audienceId: labAudience.id,
      userId: ids.staffB,
      labId: ids.labA,
      recipientAuthzVersion: 1,
      recipientRole: "animal_staff",
      recipientMembershipRole: "staff",
    },
  }));

  await prisma.labMembership.update({
    where: { labId_userId: { labId: ids.labA, userId: ids.staffA } },
    data: { active: false },
  });
  const revokedInbox = await getNotificationInboxView(actorA);
  assert(revokedInbox.notifications.every((item) => item.recipientId !== recipient.id), "Revoked member retained inbox access.");
  const revoked = await prisma.notificationRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
  assert(revoked.status === "revoked" && revoked.revokedAt && revoked.revokeReason, "Recipient was not durably revoked.");

  await prisma.$transaction([
    prisma.labMembership.update({
      where: { labId_userId: { labId: ids.labA, userId: ids.staffA } },
      data: { active: true, role: "manager" },
    }),
    prisma.user.update({ where: { id: ids.staffA }, data: { authzVersion: { increment: 1 } } }),
  ]);
  await materializeDashboardNotifications({
    alerts: [alert],
    scopeLabIds: [ids.labA],
    includeGlobal: false,
    producerId: ids.staffA,
    resolveMissing: false,
  });
  const staffGenerations = await prisma.notificationRecipient.findMany({
    where: { eventId: event.id, userId: ids.staffA },
    orderBy: { materializedAt: "asc" },
  });
  assert(
    staffGenerations.length === 2
      && staffGenerations[0]?.status === "revoked"
      && staffGenerations[1]?.status === "active"
      && staffGenerations[1]?.recipientMembershipRole === "manager",
    "Recipient reauthorization did not preserve the revoked generation and create a new active row.",
  );

  await expectRejected("recipient delete", () => prisma.notificationRecipient.delete({ where: { id: recipient.id } }));
  await expectRejected("audience delete", () => prisma.notificationAudience.delete({ where: { id: labAudience.id } }));
  await expectRejected("event delete", () => prisma.notificationEvent.delete({ where: { id: event.id } }));
  await expectRejected("delivery delete", () => prisma.notificationDelivery.delete({ where: { id: adminDelivery.id } }));
  await expectRejected("preference delete", () => prisma.notificationPreference.delete({ where: { id: preference.id } }));

  console.log(JSON.stringify({
    eventId: event.id,
    recipients: [...recipientUserIds].sort(),
    readVersion: readRow.version,
    revokedVersion: revoked.version,
    staleRejected: true,
    foreignRejected: true,
    historyProtected: true,
    ownershipBound: true,
    recipientGenerations: staffGenerations.length,
    urgentDeliveryCompleted: true,
    routineDigestCancelled: true,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
