import { compareDesc } from "date-fns";

import { getDashboardAlertsView } from "@/lib/dashboard-read";
import { prisma } from "@/lib/prisma";
import type {
  Alert,
  NotificationCategoryKey,
  NotificationInboxView,
  NotificationItem,
  NotificationPreference,
} from "@/lib/types";

type NotificationDefinition = {
  ruleKey: string;
  categoryKey: NotificationCategoryKey;
  categoryLabel: string;
  description: string;
  alertTypes: string[];
  hrefForAlert: (alert: Alert) => string;
  actionLabelForAlert: (alert: Alert) => string;
};

const notificationDefinitions: NotificationDefinition[] = [
  {
    ruleKey: "notify_in_app_genotype_pending",
    categoryKey: "genotype_pending",
    categoryLabel: "Overdue genotypes",
    description: "Animals still waiting on genotype confirmation beyond the configured threshold.",
    alertTypes: ["genotype_pending"],
    hrefForAlert: (alert) => `/animals/${alert.entityId}`,
    actionLabelForAlert: () => "Open animal",
  },
  {
    ruleKey: "notify_in_app_weaning_due",
    categoryKey: "weaning_due",
    categoryLabel: "Weaning queue",
    description: "Litters that have reached weaning age without a recorded outcome.",
    alertTypes: ["weaning_due"],
    hrefForAlert: () => "/breeding",
    actionLabelForAlert: () => "Open breeding",
  },
  {
    ruleKey: "notify_in_app_breeder_age",
    categoryKey: "breeder_age",
    categoryLabel: "Breeder age",
    description: "Breeders outside the preferred age window and needing review.",
    alertTypes: ["breeder_too_old", "breeder_too_young"],
    hrefForAlert: (alert) => `/animals/${alert.entityId}`,
    actionLabelForAlert: () => "Open animal",
  },
  {
    ruleKey: "notify_in_app_welfare",
    categoryKey: "welfare",
    categoryLabel: "Welfare follow-up",
    description: "Unresolved health and welfare notes that still need action.",
    alertTypes: ["health_followup", "welfare_note", "welfare_followup"],
    hrefForAlert: (alert) => (alert.entityType === "cage" ? `/cages/${alert.entityId}` : `/animals/${alert.entityId}`),
    actionLabelForAlert: (alert) => (alert.entityType === "cage" ? "Open cage" : "Open animal"),
  },
  {
    ruleKey: "notify_in_app_reservation_drift",
    categoryKey: "reservation_drift",
    categoryLabel: "Reservation drift",
    description: "Reserved assignments that have not started within the grace period.",
    alertTypes: ["reserved_not_started"],
    hrefForAlert: () => "/experiments",
    actionLabelForAlert: () => "Open experiments",
  },
];

function getSeverityRank(severity: Alert["severity"]) {
  if (severity === "critical") {
    return 3;
  }

  if (severity === "warning") {
    return 2;
  }

  return 1;
}

function mapAlertToNotification(alert: Alert, definition: NotificationDefinition): NotificationItem {
  return {
    id: `${definition.categoryKey}-${alert.id}`,
    categoryKey: definition.categoryKey,
    categoryLabel: definition.categoryLabel,
    description: definition.description,
    deliveryChannel: "in_app",
    severity: alert.severity,
    message: alert.message,
    generatedAt: alert.generatedAt,
    source: alert.source,
    alertType: alert.alertType,
    entityType: alert.entityType,
    entityId: alert.entityId,
    href: definition.hrefForAlert(alert),
    actionLabel: definition.actionLabelForAlert(alert),
  };
}

export async function getNotificationInboxView(): Promise<NotificationInboxView> {
  const [alerts, rules] = await Promise.all([
    getDashboardAlertsView(),
    prisma.ruleConfig.findMany({
      where: {
        key: { in: notificationDefinitions.map((definition) => definition.ruleKey) },
      },
      select: {
        key: true,
        value: true,
      },
    }),
  ]);
  const ruleValues = new Map(rules.map((rule) => [rule.key, Boolean(rule.value)]));
  const alertsByDefinition = new Map<NotificationDefinition["ruleKey"], Alert[]>();

  for (const definition of notificationDefinitions) {
    alertsByDefinition.set(
      definition.ruleKey,
      alerts.filter((alert) => definition.alertTypes.includes(alert.alertType)),
    );
  }

  const preferences: NotificationPreference[] = notificationDefinitions.map((definition) => ({
    ruleKey: definition.ruleKey,
    categoryKey: definition.categoryKey,
    categoryLabel: definition.categoryLabel,
    description: definition.description,
    enabled: ruleValues.get(definition.ruleKey) ?? true,
    matchingAlertCount: alertsByDefinition.get(definition.ruleKey)?.length ?? 0,
  }));

  const notifications = notificationDefinitions
    .flatMap((definition) => {
      const preference = preferences.find((entry) => entry.ruleKey === definition.ruleKey);

      if (!preference?.enabled) {
        return [];
      }

      return (alertsByDefinition.get(definition.ruleKey) ?? []).map((alert) => mapAlertToNotification(alert, definition));
    })
    .sort((left, right) => {
      const severityDelta = getSeverityRank(right.severity) - getSeverityRank(left.severity);

      if (severityDelta !== 0) {
        return severityDelta;
      }

      return compareDesc(new Date(left.generatedAt), new Date(right.generatedAt));
    });

  return {
    notifications,
    preferences,
    summary: {
      total: notifications.length,
      critical: notifications.filter((notification) => notification.severity === "critical").length,
      warning: notifications.filter((notification) => notification.severity === "warning").length,
      info: notifications.filter((notification) => notification.severity === "info").length,
      enabledCategories: preferences.filter((preference) => preference.enabled).length,
      mutedCategories: preferences.filter((preference) => !preference.enabled).length,
    },
  };
}
