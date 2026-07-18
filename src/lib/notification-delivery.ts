import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import type { OutboxMessage } from "@prisma/client";

import {
  authenticateOutboxWorker,
  type ClaimedNotificationProviderPayload,
  claimOutboxMessages,
  deliverClaimedNotificationMessage,
  failOutboxMessage,
  type NotificationProviderIdentity,
} from "@/lib/command-foundation";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";

type EmailProviderConfig = {
  enabled: boolean;
  configured: boolean;
  error: string | null;
  url: string | null;
  from: string | null;
  identity: NotificationProviderIdentity | null;
};

const NOTIFICATION_EMAIL_PROVIDER_ADAPTER = "http-json-email-v1";

export type NotificationDeliveryBatch = {
  generatedAt: string;
  queuedCount: number;
  readyCount: number;
  failedCount: number;
  deliveredCount: number;
  provider: {
    enabled: boolean;
    configured: boolean;
    error: string | null;
  };
};

export type NotificationDeliveryResult = {
  dryRun: boolean;
  delivered: number;
  failed: number;
  cancelled: number;
  message: string;
  batch: NotificationDeliveryBatch;
};

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function privateOrReservedIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [first, second, third] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 192 && second === 88 && third === 99)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}

function parseIpv6(address: string) {
  let normalized = normalizeHostname(address).split("%")[0];
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map(Number);
    normalized = `${normalized.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.reduce((value, group) => (value << BigInt(16)) | BigInt(`0x${group}`), BigInt(0));
}

function ipv6InPrefix(address: string, prefix: string, prefixLength: number) {
  const value = parseIpv6(address);
  const base = parseIpv6(prefix);
  if (value === null || base === null) return true;
  const shift = BigInt(128 - prefixLength);
  return (value >> shift) === (base >> shift);
}

function privateOrReservedIp(address: string) {
  const normalized = normalizeHostname(address);
  if (isIP(normalized) === 4) return privateOrReservedIpv4(normalized);
  if (isIP(normalized) !== 6) return false;
  if (!ipv6InPrefix(normalized, "2000::", 3)) return true;
  return [
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
  ].some(([prefix, length]) => ipv6InPrefix(normalized, prefix as string, length as number));
}

function privateNetworkHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || privateOrReservedIp(normalized);
}

export function validateNotificationEmailProviderUrl(rawUrl: string, options?: {
  production?: boolean;
  allowedHosts?: string[];
}) {
  try {
    const url = new URL(rawUrl);
    const production = options?.production ?? process.env.NODE_ENV === "production";
    const allowedHosts = options?.allowedHosts ?? [];
    if (url.username || url.password) return { ok: false as const, message: "Provider URL credentials are not allowed." };
    if (production && url.protocol !== "https:") return { ok: false as const, message: "Production email delivery requires HTTPS." };
    if (!production && !["http:", "https:"].includes(url.protocol)) return { ok: false as const, message: "Email provider URL must use HTTP or HTTPS." };
    if (production && privateNetworkHostname(url.hostname)) return { ok: false as const, message: "Production email delivery cannot target a private network host." };
    if (allowedHosts.length && !allowedHosts.map(normalizeHostname).includes(normalizeHostname(url.hostname))) {
      return { ok: false as const, message: "Email provider host is not in the deployment allowlist." };
    }
    if (production && !allowedHosts.length) {
      return { ok: false as const, message: "Production email delivery requires NOTIFICATION_EMAIL_PROVIDER_HOSTS." };
    }
    return { ok: true as const, url: url.toString() };
  } catch {
    return { ok: false as const, message: "Email provider URL is invalid." };
  }
}

async function resolvePublicProviderAddress(rawUrl: string) {
  const hostname = normalizeHostname(new URL(rawUrl).hostname);
  if (privateNetworkHostname(hostname)) throw new Error("Email provider hostname is not globally reachable.");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => privateOrReservedIp(entry.address))) {
    throw new Error("Email provider hostname must resolve only to public addresses.");
  }
  return addresses[0]!;
}

async function getEmailProviderConfig(): Promise<EmailProviderConfig> {
  const enabledRule = await prisma.ruleConfig.findUnique({
    where: { key: "notify_email_enabled" },
    select: { value: true },
  });
  const enabled = Boolean(enabledRule?.value ?? false);
  const rawUrl = process.env.NOTIFICATION_EMAIL_PROVIDER_URL?.trim() ?? "";
  const from = process.env.NOTIFICATION_EMAIL_FROM?.trim() ?? "";
  if (!rawUrl || !from) {
    return {
      enabled,
      configured: false,
      error: "Set NOTIFICATION_EMAIL_PROVIDER_URL and NOTIFICATION_EMAIL_FROM in the deployment environment.",
      url: null,
      from: null,
      identity: null,
    };
  }
  if (!notificationProviderSupportsIdempotency()) {
    return {
      enabled,
      configured: false,
      error: "Set NOTIFICATION_EMAIL_PROVIDER_SUPPORTS_IDEMPOTENCY=true only after the provider adapter contract is verified.",
      url: null,
      from: null,
      identity: null,
    };
  }
  const allowedHosts = (process.env.NOTIFICATION_EMAIL_PROVIDER_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const validation = validateNotificationEmailProviderUrl(rawUrl, { allowedHosts });
  if (!validation.ok) {
    return { enabled, configured: false, error: validation.message, url: null, from: null, identity: null };
  }
  if (process.env.NODE_ENV === "production") {
    try {
      await resolvePublicProviderAddress(validation.url);
    } catch {
      return { enabled, configured: false, error: "Email provider host could not be resolved safely.", url: null, from: null, identity: null };
    }
  }
  const account = from.toLowerCase();
  return {
    enabled,
    configured: true,
    error: null,
    url: validation.url,
    from,
    identity: {
      adapter: NOTIFICATION_EMAIL_PROVIDER_ADAPTER,
      endpoint: validation.url,
      account,
    },
  };
}

function assertDeliveryActor(actor: ResolvedActor) {
  if (!actor.capabilities.includes("notifications:deliver")) {
    throw new Error("Current notification delivery capability is required.");
  }
}

export async function buildNotificationDeliveryBatch(actor: ResolvedActor): Promise<NotificationDeliveryBatch> {
  assertDeliveryActor(actor);
  const now = new Date();
  const [provider, queuedCount, readyCount, failedCount, deliveredCount] = await Promise.all([
    getEmailProviderConfig(),
    prisma.notificationDelivery.count({ where: { status: "queued" } }),
    prisma.notificationDelivery.count({ where: { status: "queued", scheduledFor: { lte: now } } }),
    prisma.notificationDelivery.count({ where: { status: "failed" } }),
    prisma.notificationDelivery.count({ where: { status: "delivered" } }),
  ]);
  return {
    generatedAt: now.toISOString(),
    queuedCount,
    readyCount,
    failedCount,
    deliveredCount,
    provider: { enabled: provider.enabled, configured: provider.configured, error: provider.error },
  };
}

function emailHeaders(idempotencyKey: string) {
  const token = process.env.NOTIFICATION_EMAIL_API_TOKEN?.trim();
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function notificationProviderSupportsIdempotency(
  value = process.env.NOTIFICATION_EMAIL_PROVIDER_SUPPORTS_IDEMPOTENCY,
) {
  return value?.trim().toLowerCase() === "true";
}

export function buildNotificationEmailProviderRequest(input: {
  deliveryId: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}) {
  return {
    headers: emailHeaders(input.deliveryId),
    body: JSON.stringify({
      from: input.from,
      idempotencyKey: input.deliveryId,
      to: input.to,
      subject: input.subject,
      text: input.text,
    }),
  };
}

async function postNotificationEmailProvider(input: {
  url: string;
  headers: Record<string, string>;
  body: string;
}) {
  const url = new URL(input.url);
  const production = process.env.NODE_ENV === "production";
  const pinned = production ? await resolvePublicProviderAddress(url.toString()) : null;
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<{ status: number; providerMessageId: string | null }>((resolve, reject) => {
    const providerRequest = request({
      protocol: url.protocol,
      hostname: pinned?.address ?? normalizeHostname(url.hostname),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "POST",
      headers: {
        ...input.headers,
        Host: url.host,
        "Content-Length": Buffer.byteLength(input.body),
      },
      ...(url.protocol === "https:" ? { servername: normalizeHostname(url.hostname) } : {}),
    }, (response) => {
      response.resume();
      response.once("end", () => {
        const messageHeader = response.headers["x-message-id"];
        resolve({
          status: response.statusCode ?? 0,
          providerMessageId: Array.isArray(messageHeader) ? messageHeader[0] ?? null : messageHeader ?? null,
        });
      });
    });
    providerRequest.setTimeout(10_000, () => {
      providerRequest.destroy(new Error("Email provider request timed out."));
    });
    providerRequest.once("error", reject);
    providerRequest.end(input.body);
  });
}

function buildEmail(group: ClaimedNotificationProviderPayload[]) {
  const first = group[0]!;
  const urgent = first.kind === "immediate";
  const subject = urgent
    ? `Urgent colony welfare alert: ${first.severity}`
    : `Mouse Colony Manager: ${group.length} notification${group.length === 1 ? "" : "s"}`;
  const body = [
    `Hello ${first.recipientName || "colony user"},`,
    "",
    ...group.flatMap((item) => [
      `[${item.severity.toUpperCase()}] ${item.categoryKey.replaceAll("_", " ")}`,
      item.messageText,
      `${item.actionLabel}: ${item.deepLink}`,
      `Recorded: ${item.occurredAt.toISOString()}`,
      "",
    ]),
  ].join("\n").trim();
  return { to: first.email, subject, text: body };
}

function retryAt(message: OutboxMessage) {
  const delayMinutes = Math.min(60, 2 ** Math.max(0, message.attemptCount - 1));
  return new Date(Date.now() + delayMinutes * 60_000);
}

export async function deliverNotificationDigest(
  input: { dryRun: boolean; limit?: number },
  actor: ResolvedActor,
): Promise<NotificationDeliveryResult> {
  assertDeliveryActor(actor);
  const batch = await buildNotificationDeliveryBatch(actor);
  if (input.dryRun) {
    return { dryRun: true, delivered: 0, failed: 0, cancelled: 0, message: "Dry run inspected the durable delivery queue without claiming jobs.", batch };
  }
  const provider = await getEmailProviderConfig();
  if (!provider.enabled || !provider.configured || !provider.url || !provider.from || !provider.identity) {
    return {
      dryRun: false,
      delivered: 0,
      failed: 0,
      cancelled: 0,
      message: provider.enabled ? provider.error ?? "Email provider is not configured." : "Email delivery is disabled.",
      batch,
    };
  }
  const workerToken = process.env.OUTBOX_WORKER_TOKEN_NOTIFICATION_DELIVERY?.trim() ?? "";
  const worker = authenticateOutboxWorker({
    workerId: `notification-api:${actor.id}`,
    workerType: "notification_delivery",
    token: workerToken,
  });
  if (!worker) {
    return { dryRun: false, delivered: 0, failed: 0, cancelled: 0, message: "Notification worker authentication is not configured.", batch };
  }

  const claimed = await claimOutboxMessages({ worker, limit: input.limit ?? 25 });
  let delivered = 0;
  let failed = 0;
  let cancelled = 0;
  for (const message of claimed) {
    if (!message.leaseToken) continue;
    try {
      const result = await deliverClaimedNotificationMessage({
        messageId: message.id,
        worker,
        leaseToken: message.leaseToken,
        provider: provider.identity,
        prepare: (payload) => {
          const email = buildEmail([payload]);
          return buildNotificationEmailProviderRequest({
            deliveryId: payload.deliveryId,
            from: provider.from!,
            ...email,
          });
        },
        send: async (request) => {
          const response = await postNotificationEmailProvider({
            url: request.providerEndpoint,
            headers: emailHeaders(request.idempotencyKey),
            body: request.body,
          });
          if (response.status < 200 || response.status >= 300) {
            throw new Error(`Email provider returned HTTP ${response.status}.`);
          }
          return {
            providerMessageId: response.providerMessageId,
            providerStatus: response.status,
          };
        },
      });
      if (result.status === "delivered") delivered += 1;
      else if (result.status === "reconciliation_required") failed += 1;
      else cancelled += 1;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Email provider request failed.";
      const recorded = await failOutboxMessage({
        messageId: message.id,
        worker,
        leaseToken: message.leaseToken,
        errorMessage: messageText,
        retryAt: retryAt(message),
      });
      if (recorded) failed += 1;
      else cancelled += 1;
    }
  }

  return {
    dryRun: false,
    delivered,
    failed,
    cancelled,
    message: `Processed ${delivered + failed + cancelled} delivery job${delivered + failed + cancelled === 1 ? "" : "s"}.`,
    batch,
  };
}
