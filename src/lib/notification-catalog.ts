import type { Alert, NotificationCategoryKey } from "@/lib/types";

export type NotificationDefinition = {
  ruleKey: string;
  categoryKey: NotificationCategoryKey;
  categoryLabel: string;
  description: string;
  alertTypes: string[];
  audiencePolicy?: "lab_members_only" | "lab_and_facility";
  hrefForAlert: (alert: Alert) => string;
  actionLabelForAlert: (alert: Alert) => string;
};

export const notificationDefinitions: NotificationDefinition[] = [
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
    ruleKey: "notify_in_app_invoice",
    categoryKey: "invoice",
    categoryLabel: "Invoices",
    description: "Finalized or voided invoices for labs where you are an active member.",
    alertTypes: ["invoice_finalized", "invoice_voided"],
    audiencePolicy: "lab_members_only",
    hrefForAlert: (alert) => `/billing/invoices/${alert.entityId}`,
    actionLabelForAlert: () => "Open invoice",
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

export function getNotificationDefinition(alertType: string) {
  return notificationDefinitions.find((definition) => definition.alertTypes.includes(alertType)) ?? null;
}

export function isUrgentNotification(alert: Pick<Alert, "alertType" | "severity">) {
  const definition = getNotificationDefinition(alert.alertType);
  return definition?.categoryKey === "welfare" && (alert.severity === "warning" || alert.severity === "critical");
}
