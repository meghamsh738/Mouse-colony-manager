import Link from "next/link";

import { InlineSection } from "@/components/app/layout-primitives";
import { NotificationRecipientActions } from "@/components/app/notification-recipient-actions";
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
    <InlineSection
      title="Inbox"
      meta={
        <>
          <span>{inbox.summary.critical} critical</span>
          <span>·</span>
          <span>{inbox.summary.warning} warning</span>
          <span>·</span>
          <span>{inbox.summary.info} info</span>
        </>
      }
      actions={<Badge variant="neutral">{inbox.summary.total} items</Badge>}
    >
      {inbox.notifications.length ? (
        <div className="row-list" data-testid="notification-feed">
          {inbox.notifications.map((notification) => (
            <article
              key={notification.id}
              className={`triage-row scroll-mt-32 md:grid-cols-[8rem_minmax(0,0.9fr)_minmax(0,1.2fr)_auto] md:items-start md:scroll-mt-10 ${
                notification.severity === "critical"
                  ? "triage-row-critical"
                  : notification.severity === "warning"
                    ? "triage-row-warning"
                    : ""
              }`}
              data-testid={`notification-item-${notification.categoryKey}-${notification.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={severityVariant(notification.severity)}>{notification.severity}</Badge>
                {!notification.readAt ? <Badge variant="info">unread</Badge> : null}
                {notification.acknowledgedAt ? <Badge variant="success">acknowledged</Badge> : null}
                {notification.urgent ? <Badge variant="danger">urgent</Badge> : null}
              </div>
              <div className="min-w-0">
                <p className="wrap-value text-sm font-semibold text-[var(--ink)]">{notification.targetLabel}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.1em] text-[var(--muted)]">
                  {notification.entityType}
                </p>
              </div>
              <div className="min-w-0">
                <p className="wrap-value text-sm leading-6 text-[var(--ink)]">{notification.message}</p>
                <p className="mt-1 wrap-value text-xs uppercase tracking-[0.1em] text-[var(--muted)]">
                  {notification.categoryLabel} · {formatDate(notification.generatedAt)}
                </p>
              </div>
              <div className="flex min-w-0 flex-col items-start gap-2 md:items-end">
                <Link
                  aria-label={`${notification.actionLabel}: ${notification.targetLabel}`}
                  className="action-chip relative z-10 justify-self-start scroll-mt-32 md:justify-self-end md:scroll-mt-10"
                  data-testid={`notification-link-${notification.categoryKey}-${notification.id}`}
                  href={notification.href}
                >
                  {notification.actionLabel}
                </Link>
                <NotificationRecipientActions notification={notification} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-white/60 px-5 py-8 text-sm leading-7 text-[var(--muted)]">
          No in-app notifications are currently active for the enabled categories.
        </div>
      )}
    </InlineSection>
  );
}
