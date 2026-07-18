import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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

function getAlertHref(alert: Alert) {
  if (alert.entityType === "animal") {
    return `/animals/${alert.entityId}`;
  }

  if (alert.entityType === "cage") {
    return `/cages/${alert.entityId}`;
  }

  if (alert.entityType === "experiment") {
    return "/experiments";
  }

  if (alert.entityType === "litter") {
    return "/breeding";
  }

  return "/notifications";
}

export function AlertFeed({ alerts, title }: { alerts: Alert[]; title: string }) {
  return (
    <section className="dashboard-lane">
      <div className="dashboard-lane-header">
        <div className="flex min-w-0 items-center gap-2">
          <h2>{title}</h2>
          <span className="lane-count">{alerts.length}</span>
        </div>
        <Link href="/notifications">View all</Link>
      </div>
      <div className="dashboard-row-list">
        {alerts.length ? (
          alerts.map((alert) => (
            <Link className="dashboard-alert-row" data-severity={alert.severity} href={getAlertHref(alert)} key={alert.id}>
              <span className="dashboard-row-priority" aria-hidden="true" />
              <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
              <div className="min-w-0">
                <p className="dashboard-row-title">{alert.message}</p>
                <p className="dashboard-row-meta">
                  {alert.alertType.replaceAll("_", " ")} · {alert.entityType} · {formatDate(alert.generatedAt)}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
            </Link>
          ))
        ) : (
          <p className="dashboard-empty-row">No priority alerts.</p>
        )}
      </div>
    </section>
  );
}
