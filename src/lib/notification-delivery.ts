import { getNotificationInboxView } from "@/lib/notifications-read";
import { prisma } from "@/lib/prisma";
import type { NotificationItem } from "@/lib/types";

type DeliveryRuleValues = {
  webhookEnabled: boolean;
  webhookUrl: string | null;
  emailEnabled: boolean;
  emailProviderUrl: string | null;
  emailFrom: string | null;
  emailRecipients: string[];
};

export type NotificationDeliveryChannelResult = {
  channel: "webhook" | "email";
  delivered: boolean;
  status: number | null;
  message: string;
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
    enabled: boolean;
    configured: boolean;
    providerConfigured: boolean;
    providerUrl: string | null;
    from: string | null;
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
  channelResults: NotificationDeliveryChannelResult[];
  batch: NotificationDeliveryBatch;
};

const deliveryRuleKeys = [
  "notify_webhook_enabled",
  "notify_webhook_url",
  "notify_email_enabled",
  "notify_email_provider_url",
  "notify_email_from",
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
  const emailProviderUrl = asText(values.get("notify_email_provider_url"));
  const emailFrom = asText(values.get("notify_email_from"));

  return {
    webhookEnabled: Boolean(values.get("notify_webhook_enabled") ?? false),
    webhookUrl: webhookUrl || null,
    emailEnabled: Boolean(values.get("notify_email_enabled") ?? false),
    emailProviderUrl: emailProviderUrl || null,
    emailFrom: emailFrom || null,
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
      enabled: rules.emailEnabled,
      configured: rules.emailRecipients.length > 0,
      providerConfigured: Boolean(rules.emailProviderUrl && rules.emailFrom),
      providerUrl: rules.emailProviderUrl,
      from: rules.emailFrom,
      recipients: rules.emailRecipients,
      subject,
      bodyText: buildDigestBody(inbox.notifications),
    },
    notifications: inbox.notifications,
  };
}

function getEmailHeaders() {
  const token = process.env.NOTIFICATION_EMAIL_API_TOKEN?.trim();

  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function deliverWebhook(batch: NotificationDeliveryBatch): Promise<NotificationDeliveryChannelResult | null> {
  if (!batch.webhook.enabled) {
    return null;
  }

  if (!batch.webhook.url) {
    return {
      channel: "webhook",
      delivered: false,
      status: null,
      message: "Webhook delivery is enabled, but no webhook URL is configured.",
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
    channel: "webhook",
    delivered: response.ok,
    status: response.status,
    message: response.ok ? "Webhook notification digest delivered." : "Webhook notification digest failed.",
  };
}

async function deliverEmail(batch: NotificationDeliveryBatch): Promise<NotificationDeliveryChannelResult | null> {
  if (!batch.emailDigest.enabled) {
    return null;
  }

  if (!batch.emailDigest.configured) {
    return {
      channel: "email",
      delivered: false,
      status: null,
      message: "Email delivery is enabled, but no digest recipients are configured.",
    };
  }

  if (!batch.emailDigest.providerConfigured || !batch.emailDigest.providerUrl || !batch.emailDigest.from) {
    return {
      channel: "email",
      delivered: false,
      status: null,
      message: "Email delivery is enabled, but provider URL or from address is missing.",
    };
  }

  const response = await fetch(batch.emailDigest.providerUrl, {
    method: "POST",
    headers: getEmailHeaders(),
    body: JSON.stringify({
      from: batch.emailDigest.from,
      to: batch.emailDigest.recipients,
      subject: batch.emailDigest.subject,
      text: batch.emailDigest.bodyText,
    }),
  });

  return {
    channel: "email",
    delivered: response.ok,
    status: response.status,
    message: response.ok ? "Email notification digest delivered." : "Email notification digest failed.",
  };
}

function summarizeDeliveryResults(results: NotificationDeliveryChannelResult[]) {
  if (!results.length) {
    return {
      delivered: false,
      status: null,
      message: "No outbound delivery channels are enabled in rule settings.",
    };
  }

  const delivered = results.some((result) => result.delivered);
  const status = results.find((result) => result.status !== null)?.status ?? null;

  return {
    delivered,
    status,
    message: results.map((result) => result.message).join(" "),
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
      channelResults: [],
      batch,
    };
  }

  const channelResults = (await Promise.all([deliverWebhook(batch), deliverEmail(batch)])).filter(
    (result): result is NotificationDeliveryChannelResult => Boolean(result),
  );
  const summary = summarizeDeliveryResults(channelResults);

  return {
    dryRun: false,
    delivered: summary.delivered,
    status: summary.status,
    message: summary.message,
    channelResults,
    batch,
  };
}
