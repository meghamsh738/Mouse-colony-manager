import { actorHasCapability } from "@/lib/capabilities";
import { prisma } from "@/lib/prisma";
import { formatRuleDisplayValue, formatRuleEditorValue } from "@/lib/rule-config";
import type { ResolvedActor } from "@/lib/session";

export type OperationalAuditHistoryInput = {
  cursor?: string | null;
  query?: string | null;
  entityType?: string | null;
  limit?: number;
};

export async function getRuleSummaryView() {
  const rules = await prisma.ruleConfig.findMany({
    where: {
      key: {
        notIn: [
          "notify_webhook_enabled",
          "notify_webhook_url",
          "notify_email_digest_recipients",
          "notify_email_provider_url",
          "notify_email_from",
        ],
      },
    },
    orderBy: [{ category: "asc" }, { label: "asc" }],
    select: {
      id: true,
      key: true,
      label: true,
      description: true,
      category: true,
      valueType: true,
      value: true,
      criticalBlock: true,
    },
  });

  return rules.map((rule) => ({
    ...rule,
    description: rule.description ?? "",
    displayValue: formatRuleDisplayValue(rule.value),
    editorValue: formatRuleEditorValue(rule.valueType, rule.value),
  }));
}

export async function getOperationalAuditHistoryView(
  actor: ResolvedActor,
  input: OperationalAuditHistoryInput = {},
) {
  if (!actorHasCapability(actor, "audit:domain")) {
    throw new Error("Operational audit history is unavailable.");
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const query = input.query?.trim();
  const entityType = input.entityType?.trim();
  const logs = await prisma.auditLog.findMany({
    where: {
      AND: [
        { entityType: { notIn: ["user_invitation", "user_role", "user_access"] } },
        ...(entityType ? [{ entityType: { equals: entityType, mode: "insensitive" as const } }] : []),
      ],
      ...(query ? {
        OR: [
          { action: { contains: query, mode: "insensitive" as const } },
          { entityType: { contains: query, mode: "insensitive" as const } },
          { entityId: { contains: query, mode: "insensitive" as const } },
          { requestId: { contains: query, mode: "insensitive" as const } },
          { actor: { name: { contains: query, mode: "insensitive" as const } } },
          { lab: { code: { contains: query, mode: "insensitive" as const } } },
        ],
      } : {}),
    },
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      actorRole: true,
      entityType: true,
      entityId: true,
      requestId: true,
      timestamp: true,
      actor: {
        select: {
          name: true,
        },
      },
      lab: { select: { code: true } },
    },
  });

  const hasMore = logs.length > limit;
  const page = logs.slice(0, limit);
  const items = page.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actorRole: log.actorRole,
    labCode: log.lab?.code ?? null,
    requestId: log.requestId,
    timestamp: log.timestamp.toISOString(),
    actor: log.actor,
  }));

  return {
    items,
    nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
  };
}

export async function getRecentAuditLogsView(actor: ResolvedActor, limit = 20) {
  const page = await getOperationalAuditHistoryView(actor, { limit });
  return page.items;
}
