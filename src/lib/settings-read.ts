import { prisma } from "@/lib/prisma";
import { formatRuleDisplayValue, formatRuleEditorValue } from "@/lib/rule-config";

export async function getRuleSummaryView() {
  const rules = await prisma.ruleConfig.findMany({
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
