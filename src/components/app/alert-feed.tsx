import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/app/surface";
import type { Alert } from "@/lib/types";
import { formatDate } from "@/lib/utils";

function severityVariant(severity: Alert["severity"]) {
  if (severity === "critical") {
    return "danger";
  }

  if (severity === "warning") {
    return "warning";
  }

  return "info";
}

export function AlertFeed({ alerts, title }: { alerts: Alert[]; title: string }) {
  return (
    <Surface className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold tracking-[-0.04em]">{title}</h2>
        <Badge variant="neutral">{alerts.length} items</Badge>
      </div>
      <div className="space-y-3">
        {alerts.map((alert) => (
          <article key={alert.id} className="rounded-2xl border border-[var(--line)] bg-white/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
              <Badge variant="neutral">{alert.alertType.replaceAll("_", " ")}</Badge>
            </div>
            <p className="mt-3 text-sm leading-7 text-[var(--ink)]">{alert.message}</p>
            <p className="mt-2 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
              {alert.entityType} · {formatDate(alert.generatedAt)}
            </p>
          </article>
        ))}
      </div>
    </Surface>
  );
}
