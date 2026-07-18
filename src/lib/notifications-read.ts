import { compareDesc } from "date-fns";
import { Prisma } from "@prisma/client";

import { normalizeUserRole } from "@/lib/capabilities";
import { getDashboardAlertsView } from "@/lib/dashboard-read";
import { type ActorLabAccess, type LabActor } from "@/lib/lab-access";
import { notificationDefinitions } from "@/lib/notification-catalog";
import { materializeDashboardNotifications } from "@/lib/notification-materialization";
import { prisma } from "@/lib/prisma";
import type {
  Alert,
  NotificationCategoryKey,
  NotificationInboxView,
  NotificationItem,
  NotificationPreference,
} from "@/lib/types";

function getSeverityRank(severity: Alert["severity"]) {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function targetKey(alert: Pick<Alert, "entityType" | "entityId">) {
  return `${alert.entityType}:${alert.entityId}`;
}

function fallbackTargetLabel(alert: Pick<Alert, "entityType" | "entityId">) {
  return `${alert.entityType.replaceAll("_", " ")} ${alert.entityId}`;
}

function formatCageLabel(cage: {
  barcode: string;
  cageNumber: string;
  room: { roomNumber: string };
  rack: { rackNumber: string };
}) {
  return `Cage ${cage.room.roomNumber} / ${cage.rack.rackNumber} / ${cage.cageNumber} · ${cage.barcode}`;
}

async function buildTargetLabels(alerts: Alert[], access: ActorLabAccess) {
  const scopedLabWhere = !access.canViewAll ? { in: access.memberLabIds } : undefined;
  const idsByType = new Map<Alert["entityType"], string[]>();

  for (const alert of alerts) {
    const ids = idsByType.get(alert.entityType) ?? [];
    ids.push(alert.entityId);
    idsByType.set(alert.entityType, ids);
  }

  const uniqueIds = (type: Alert["entityType"]) => [...new Set(idsByType.get(type) ?? [])];
  const [animals, cages, litters, experiments, projects] = await Promise.all([
    prisma.animal.findMany({
      where: { id: { in: uniqueIds("animal") }, ...(scopedLabWhere ? { owningLabId: scopedLabWhere } : {}) },
      select: {
        id: true,
        animalId: true,
        currentCage: {
          select: {
            barcode: true,
            cageNumber: true,
            room: { select: { roomNumber: true } },
            rack: { select: { rackNumber: true } },
          },
        },
      },
    }),
    prisma.cage.findMany({
      where: { id: { in: uniqueIds("cage") }, ...(scopedLabWhere ? { labId: scopedLabWhere } : {}) },
      select: {
        id: true,
        barcode: true,
        cageNumber: true,
        room: { select: { roomNumber: true } },
        rack: { select: { rackNumber: true } },
      },
    }),
    prisma.litter.findMany({
      where: { id: { in: uniqueIds("litter") }, ...(scopedLabWhere ? { breedingSetup: { labId: scopedLabWhere } } : {}) },
      select: { id: true, breedingSetupId: true },
    }),
    prisma.experiment.findMany({
      where: { id: { in: uniqueIds("experiment") }, ...(scopedLabWhere ? { labId: scopedLabWhere } : {}) },
      select: { id: true, experimentCode: true },
    }),
    prisma.project.findMany({
      where: { id: { in: uniqueIds("project") }, ...(scopedLabWhere ? { labId: scopedLabWhere } : {}) },
      select: { id: true, projectCode: true },
    }),
  ]);

  const labels = new Map<string, string>();
  for (const animal of animals) {
    labels.set(
      `animal:${animal.id}`,
      animal.currentCage
        ? `Animal ${animal.animalId} · ${formatCageLabel(animal.currentCage)}`
        : `Animal ${animal.animalId}`,
    );
  }
  for (const cage of cages) labels.set(`cage:${cage.id}`, formatCageLabel(cage));
  for (const litter of litters) labels.set(`litter:${litter.id}`, `Litter ${litter.id} · Breeding ${litter.breedingSetupId}`);
  for (const experiment of experiments) labels.set(`experiment:${experiment.id}`, `Experiment ${experiment.experimentCode}`);
  for (const project of projects) labels.set(`project:${project.id}`, `Project ${project.projectCode}`);
  return labels;
}

type RecipientRow = Awaited<ReturnType<typeof loadRecipientRows>>[number];

async function loadRecipientRows(
  userId: string,
  database: Pick<Prisma.TransactionClient, "notificationRecipient"> = prisma,
) {
  return database.notificationRecipient.findMany({
    where: {
      userId,
      status: "active",
      resolvedAt: null,
      event: { status: { not: "resolved" } },
    },
    include: {
      event: true,
      audience: true,
    },
    orderBy: [{ event: { urgent: "desc" } }, { event: { occurredAt: "desc" } }, { id: "asc" }],
  });
}

type CurrentNotificationScope = {
  actor: LabActor;
  authzVersion: number;
  databaseRole: RecipientRow["recipientRole"];
  canonicalRole: ReturnType<typeof normalizeUserRole>;
  access: ActorLabAccess;
};

async function getCurrentNotificationScope(
  actor: LabActor & { authzVersion?: number },
  database: Pick<Prisma.TransactionClient, "user"> = prisma,
): Promise<CurrentNotificationScope | null> {
  const user = await database.user.findUnique({
    where: { id: actor.id },
    select: {
      active: true,
      role: true,
      authzVersion: true,
      labMemberships: {
        where: { active: true, lab: { active: true } },
        select: { labId: true, role: true },
      },
    },
  });
  if (!user?.active || actor.authzVersion !== undefined && actor.authzVersion !== user.authzVersion) return null;
  const canonicalRole = normalizeUserRole(user.role);
  const selectedMemberships = canonicalRole === "lab_user"
    ? actor.activeLabId
      ? user.labMemberships.filter((membership) => membership.labId === actor.activeLabId)
      : user.labMemberships.length === 1 ? user.labMemberships : []
    : [];
  const access: ActorLabAccess = canonicalRole === "facility_admin" || canonicalRole === "cmu_staff"
    ? { canViewAll: true, memberLabIds: [], manageableLabIds: [], membershipByLabId: new Map() }
    : {
        canViewAll: false,
        memberLabIds: selectedMemberships.map((membership) => membership.labId),
        manageableLabIds: selectedMemberships
          .filter((membership) => ["owner", "manager", "staff"].includes(membership.role))
          .map((membership) => membership.labId),
        membershipByLabId: new Map(selectedMemberships.map((membership) => [membership.labId, membership.role])),
      };
  return {
    actor: { id: actor.id, role: user.role, activeLabId: actor.activeLabId },
    authzVersion: user.authzVersion,
    databaseRole: user.role,
    canonicalRole,
    access,
  };
}

function recipientIsAuthorized(row: RecipientRow, scope: CurrentNotificationScope) {
  const audience = row.audience;
  if (
    row.recipientAuthzVersion !== scope.authzVersion
    || row.recipientRole !== scope.databaseRole
    || audience.eventId !== row.eventId
    || row.labId !== row.event.labId
    || row.event.labId && !scope.access.canViewAll && !scope.access.memberLabIds.includes(row.event.labId)
  ) return false;
  if (audience.audienceType === "facility_role") {
    return row.recipientMembershipRole === null && audience.facilityRole === scope.canonicalRole;
  }
  if (audience.audienceType === "user" && audience.userId !== scope.actor.id) return false;
  if (!row.event.labId) return audience.audienceType === "user" && row.recipientMembershipRole === null;
  const membershipRole = scope.access.membershipByLabId.get(row.event.labId);
  return Boolean(
    membershipRole
    && membershipRole === row.recipientMembershipRole
    && (audience.audienceType !== "lab_members" || audience.labId === row.event.labId),
  );
}

async function loadAndReauthorizeRecipientRows(actor: LabActor & { authzVersion?: number }) {
  return prisma.$transaction(async (tx) => {
    const scope = await getCurrentNotificationScope(actor, tx);
    if (!scope) return { rows: [] as RecipientRow[], scope: null };
    const rows = await loadRecipientRows(actor.id, tx);
    const authorized: RecipientRow[] = [];
    const revokedAt = new Date();
    for (const row of rows) {
      if (recipientIsAuthorized(row, scope)) {
        authorized.push(row);
        continue;
      }
      await tx.notificationRecipient.updateMany({
        where: { id: row.id, userId: actor.id, status: "active", version: row.version },
        data: {
          status: "revoked",
          revokedAt,
          revokeReason: "Current role or lab membership no longer authorizes this notification.",
          version: { increment: 1 },
        },
      });
    }
    return { rows: authorized, scope };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function mapRecipientToNotification(
  row: RecipientRow,
  targetLabels: Map<string, string>,
): NotificationItem | null {
  const definition = notificationDefinitions.find((candidate) => candidate.categoryKey === row.event.categoryKey);
  if (!definition) return null;
  const alert: Alert = {
    id: row.event.id,
    labId: row.event.labId,
    entityType: row.event.entityType as Alert["entityType"],
    entityId: row.event.entityId,
    alertType: definition.alertTypes[0] ?? row.event.categoryKey,
    severity: row.event.severity,
    message: row.event.message,
    status: row.event.status,
    generatedAt: row.event.occurredAt.toISOString(),
    resolvedAt: row.event.resolvedAt?.toISOString(),
    source: row.event.source === "manual" || row.event.source === "billing" ? row.event.source : "rule",
  };
  return {
    id: row.id,
    recipientId: row.id,
    version: row.version,
    labId: row.event.labId,
    categoryKey: row.event.categoryKey as NotificationCategoryKey,
    categoryLabel: definition.categoryLabel,
    description: definition.description,
    deliveryChannel: "in_app",
    severity: row.event.severity,
    message: row.event.message,
    generatedAt: row.event.occurredAt.toISOString(),
    source: alert.source,
    alertType: alert.alertType,
    entityType: row.event.entityType,
    entityId: row.event.entityId,
    targetLabel: targetLabels.get(targetKey(alert)) ?? fallbackTargetLabel(alert),
    href: row.event.deepLink,
    actionLabel: row.event.actionLabel,
    urgent: row.event.urgent,
    readAt: row.readAt?.toISOString() ?? null,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export async function getNotificationInboxView(
  actor: LabActor & { authzVersion?: number },
): Promise<NotificationInboxView> {
  const initialScope = await getCurrentNotificationScope(actor);
  const rules = await prisma.ruleConfig.findMany({
    where: { key: { in: notificationDefinitions.map((definition) => definition.ruleKey) } },
    select: { key: true, value: true },
  });
  const alerts = initialScope ? await getDashboardAlertsView(initialScope.actor) : [];
  if (initialScope) {
  await materializeDashboardNotifications({
    alerts,
      scopeLabIds: initialScope.access.memberLabIds,
      includeGlobal: initialScope.access.canViewAll,
    producerId: actor.id,
  });
  }
  const reauthorized = await loadAndReauthorizeRecipientRows(actor);
  const recipientRows = reauthorized.rows;
  const access = reauthorized.scope?.access ?? {
    canViewAll: false,
    memberLabIds: [],
    manageableLabIds: [],
    membershipByLabId: new Map(),
  };
  const [savedPreferences, deliveryRows] = reauthorized.scope
    ? await Promise.all([
        prisma.notificationPreference.findMany({ where: { userId: actor.id } }),
        prisma.notificationDelivery.findMany({
          where: {
            recipient: {
              userId: actor.id,
              ...(access.canViewAll ? {} : { event: { labId: { in: access.memberLabIds } } }),
            },
          },
          select: {
            id: true,
            kind: true,
            status: true,
            scheduledFor: true,
            deliveredAt: true,
            attemptCount: true,
            lastError: true,
            recipient: { select: { event: { select: { categoryKey: true } } } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
      ])
    : [[], []];
  const ruleValues = new Map(rules.map((rule) => [rule.key, Boolean(rule.value)]));
  const savedByCategory = new Map(savedPreferences.map((preference) => [preference.categoryKey, preference]));
  const alertsByDefinition = new Map(notificationDefinitions.map((definition) => [
    definition.ruleKey,
    alerts.filter((alert) => definition.alertTypes.includes(alert.alertType)),
  ]));
  const preferences: NotificationPreference[] = notificationDefinitions.map((definition) => {
    const saved = savedByCategory.get(definition.categoryKey);
    const inAppEnabled = saved?.inAppEnabled ?? ruleValues.get(definition.ruleKey) ?? true;
    return {
      id: saved?.id ?? null,
      version: saved?.version ?? 0,
      ruleKey: definition.ruleKey,
      categoryKey: definition.categoryKey,
      categoryLabel: definition.categoryLabel,
      description: definition.description,
      enabled: inAppEnabled,
      inAppEnabled,
      emailMode: saved?.emailMode ?? "off",
      digestHourUtc: saved?.digestHourUtc ?? 8,
      digestDayOfWeek: saved?.digestDayOfWeek ?? 1,
      urgentAlwaysOn: definition.categoryKey === "welfare",
      matchingAlertCount: alertsByDefinition.get(definition.ruleKey)?.length ?? 0,
    };
  });
  const targetLabels = await buildTargetLabels(
    recipientRows.map((row) => ({
      id: row.event.id,
      labId: row.event.labId,
      entityType: row.event.entityType as Alert["entityType"],
      entityId: row.event.entityId,
      alertType: row.event.categoryKey,
      severity: row.event.severity,
      message: row.event.message,
      status: row.event.status,
      generatedAt: row.event.occurredAt.toISOString(),
      source: row.event.source === "manual" || row.event.source === "billing" ? row.event.source : "rule",
    })),
    access,
  );
  const enabledCategories = new Set(
    preferences.filter((preference) => preference.enabled).map((preference) => preference.categoryKey),
  );
  const notifications = recipientRows
    .map((row) => mapRecipientToNotification(row, targetLabels))
    .filter((notification): notification is NotificationItem => Boolean(
      notification && (notification.urgent || enabledCategories.has(notification.categoryKey)),
    ))
    .sort((left, right) => {
      if (left.urgent !== right.urgent) return left.urgent ? -1 : 1;
      const severityDelta = getSeverityRank(right.severity) - getSeverityRank(left.severity);
      return severityDelta || compareDesc(new Date(left.generatedAt), new Date(right.generatedAt));
    });

  return {
    notifications,
    preferences,
    deliveryHistory: deliveryRows.map((delivery) => ({
      id: delivery.id,
      categoryKey: delivery.recipient.event.categoryKey as NotificationCategoryKey,
      kind: delivery.kind,
      status: delivery.status,
      scheduledFor: delivery.scheduledFor.toISOString(),
      deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      attemptCount: delivery.attemptCount,
      lastError: delivery.lastError,
    })),
    summary: {
      total: notifications.length,
      unread: notifications.filter((notification) => !notification.readAt).length,
      acknowledged: notifications.filter((notification) => notification.acknowledgedAt).length,
      critical: notifications.filter((notification) => notification.severity === "critical").length,
      warning: notifications.filter((notification) => notification.severity === "warning").length,
      info: notifications.filter((notification) => notification.severity === "info").length,
      enabledCategories: preferences.filter((preference) => preference.enabled).length,
      mutedCategories: preferences.filter((preference) => !preference.enabled).length,
    },
  };
}
