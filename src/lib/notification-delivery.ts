import { getNotificationInboxView } from "@/lib/notifications-read";
import { prisma } from "@/lib/prisma";
import type { NotificationItem } from "@/lib/types";

type DeliveryRuleValues = {
  webhookEnabled: boolean;
  webhookUrl: string | null;
  emailRecipients: string[];
};

export type NotificationDeliveryBatch = {
  generatedAt: string;
  notificationCount: number;
  webhook: {
    enabled: boolean;
    configured: boolean;
    url: string | null;
  };
  emailDigest: {
    configured: boolean;
    recipients: string[];
    subject: string;
    bodyText: string;
  };
  notifications: NotificationItem[];
};

export type NotificationDeliveryResult = {
  dryRun: boolean;
  delivered: boolean;
  status: number | null;
  message: string;
  batch: NotificationDeliveryBatch;
};

const deliveryRuleKeys = [
  "notify_webhook_enabled",
  "notify_webhook_url",
  "notify_email_digest_recipients",
] as const;

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseRecipients(value: unknown) {
  return asText(value)
    .split(/[,\n;]/)
    .map((recipient) => recipient.trim())
    .filter(Boolean);
}

async function getDeliveryRuleValues(): Promise<DeliveryRuleValues> {
  const rules = await prisma.ruleConfig.findMany({
    where: {
      key: { in: [...deliveryRuleKeys] },
    },
    select: {
      key: true,
      value: true,
    },
  });
  const values = new Map(rules.map((rule) => [rule.key, rule.value]));
  const webhookUrl = asText(values.get("notify_webhook_url"));

  return {
    webhookEnabled: Boolean(values.get("notify_webhook_enabled") ?? false),
    webhookUrl: webhookUrl || null,
    emailRecipients: parseRecipients(values.get("notify_email_digest_recipients")),
  };
}

function buildDigestBody(notifications: NotificationItem[]) {
  if (!notifications.length) {
    return "No active colony notifications are currently queued for outbound delivery.";
  }

  return notifications
    .map((notification) =>
      [
        `[${notification.severity.toUpperCase()}] ${notification.categoryLabel}`,
        notification.message,
        `Action: ${notification.actionLabel} (${notification.href})`,
      ].join("\n"),
    )
    .join("\n\n");
}

export async function buildNotificationDeliveryBatch(): Promise<NotificationDeliveryBatch> {
  const [rules, inbox] = await Promise.all([getDeliveryRuleValues(), getNotificationInboxView()]);
  const generatedAt = new Date().toISOString();
  const subject = `Mouse Colony Manager: ${inbox.notifications.length} active notifications`;

  return {
    generatedAt,
    notificationCount: inbox.notifications.length,
    webhook: {
      enabled: rules.webhookEnabled,
      configured: Boolean(rules.webhookUrl),
      url: rules.webhookUrl,
    },
    emailDigest: {
      configured: rules.emailRecipients.length > 0,
      recipients: rules.emailRecipients,
      subject,
      bodyText: buildDigestBody(inbox.notifications),
    },
    notifications: inbox.notifications,
  };
}

export async function deliverNotificationDigest(input: { dryRun: boolean }): Promise<NotificationDeliveryResult> {
  const batch = await buildNotificationDeliveryBatch();

  if (input.dryRun) {
    return {
      dryRun: true,
      delivered: false,
      status: null,
      message: "Dry run generated the outbound notification payload without sending it.",
      batch,
    };
  }

  if (!batch.webhook.enabled) {
    return {
      dryRun: false,
      delivered: false,
      status: null,
      message: "Webhook delivery is disabled in rule settings.",
      batch,
    };
  }

  if (!batch.webhook.url) {
    return {
      dryRun: false,
      delivered: false,
      status: null,
      message: "Webhook delivery is enabled, but no webhook URL is configured.",
      batch,
    };
  }

  const response = await fetch(batch.webhook.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(batch),
  });

  return {
    dryRun: false,
    delivered: response.ok,
    status: response.status,
    message: response.ok ? "Webhook notification digest delivered." : "Webhook notification digest failed.",
    batch,
  };
}
