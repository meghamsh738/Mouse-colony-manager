import Link from "next/link";

import { Surface } from "@/components/app/surface";
import { Badge } from "@/components/ui/badge";
import type { NotificationInboxView } from "@/lib/types";
import { formatDate } from "@/lib/utils";

function severityVariant(severity: NotificationInboxView["notifications"][number]["severity"]) {
  if (severity === "critical") {
    return "danger";
  }

  if (severity === "warning") {
    return "warning";
  }

  return "info";
}

export function NotificationFeed({ inbox }: { inbox: NotificationInboxView }) {
  return (
    <Surface className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)] pb-4">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">In-app delivery</p>
          <h2 className="font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">Live notification inbox</h2>
        </div>
        <Badge variant="neutral">{inbox.summary.total} active</Badge>
      </div>
      {inbox.notifications.length ? (
        <div className="space-y-3" data-testid="notification-feed">
          {inbox.notifications.map((notification) => (
            <article
              key={notification.id}
              className="scroll-mt-32 rounded-[24px] border border-[var(--line)] bg-white/70 p-4 md:scroll-mt-10"
              data-testid={`notification-item-${notification.categoryKey}-${notification.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={severityVariant(notification.severity)}>{notification.severity}</Badge>
                <Badge variant="neutral">{notification.categoryLabel}</Badge>
                <Badge variant="neutral">{notification.deliveryChannel.replaceAll("_", " ")}</Badge>
              </div>
              <p className="mt-3 text-sm leading-7 text-[var(--ink)]">{notification.message}</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                  {notification.entityType} · {formatDate(notification.generatedAt)}
                </p>
                <Link
                  className="relative z-10 inline-flex scroll-mt-32 text-sm font-medium text-[var(--accent)] md:scroll-mt-10"
                  data-testid={`notification-link-${notification.categoryKey}-${notification.id}`}
                  href={notification.href}
                >
                  {notification.actionLabel}
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-white/60 px-5 py-8 text-sm leading-7 text-[var(--muted)]">
          No in-app notifications are currently active for the enabled categories.
        </div>
      )}
    </Surface>
  );
}
