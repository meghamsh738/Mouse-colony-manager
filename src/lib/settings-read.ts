import { prisma } from "@/lib/prisma";

export async function getRuleSummaryView() {
  const rules = await prisma.ruleConfig.findMany({
    orderBy: [{ category: "asc" }, { label: "asc" }],
    select: {
      id: true,
      label: true,
      description: true,
      category: true,
      value: true,
      criticalBlock: true,
    },
  });

  return rules.map((rule) => ({
    ...rule,
    description: rule.description ?? "",
    displayValue: Array.isArray(rule.value) ? rule.value.join("; ") : String(rule.value),
  }));
}

export async function getRecentAuditLogsView(limit = 8) {
  const logs = await prisma.auditLog.findMany({
    orderBy: { timestamp: "desc" },
    take: limit,
    include: {
      actor: {
        select: {
          name: true,
        },
      },
    },
  });

  return logs.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    timestamp: log.timestamp.toISOString(),
    actor: log.actor,
  }));
}
