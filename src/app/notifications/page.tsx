import { NotificationFeed } from "@/components/app/notification-feed";
import { NotificationPreferenceForm } from "@/components/app/notification-preference-form";
import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { WorksheetShell } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { getNotificationInboxView } from "@/lib/notifications-read";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export default async function NotificationsPage() {
  const user = await requireUser({ capability: "notifications:read" });
  const inbox = await getNotificationInboxView(user);

  return (
    <AppShell currentPath="/notifications" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader
          breadcrumbs={[{ label: "Notifications" }]}
          title="Notifications"
        />
        <div className="command-bar">
          <span className="value-chip border-blue-300 bg-blue-50 text-blue-900">Inbox items {inbox.summary.total}</span>
          <span className="value-chip border-blue-300 bg-blue-50 text-blue-900">Unread {inbox.summary.unread}</span>
          <span className="value-chip border-emerald-300 bg-emerald-50 text-emerald-900">Acknowledged {inbox.summary.acknowledged}</span>
          <span className="value-chip border-red-300 bg-red-50 text-red-900">Critical {inbox.summary.critical}</span>
          <span className="value-chip border-amber-300 bg-amber-50 text-amber-900">Warnings {inbox.summary.warning}</span>
          <span className="value-chip border-blue-300 bg-blue-50 text-blue-900">Info {inbox.summary.info}</span>
          <span className="value-chip">Rules {inbox.summary.enabledCategories}</span>
          <span className="value-chip">Muted {inbox.summary.mutedCategories}</span>
        </div>
        <NotificationFeed inbox={inbox} />
        <WorksheetShell
          eyebrow="Personal"
          summary={<span>{inbox.preferences.length} categories</span>}
          title="Delivery preferences"
        >
          <div className="row-list">
            {inbox.preferences.map((preference) => (
              <article className="grid min-w-0 gap-3 px-4 py-4 lg:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1.6fr)] lg:items-start" key={preference.ruleKey} data-testid={`notification-preference-${preference.categoryKey}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-[var(--ink)]">{preference.categoryLabel}</p>
                    <Badge variant={preference.inAppEnabled ? "success" : "neutral"}>{preference.inAppEnabled ? "in-app" : "muted"}</Badge>
                    <Badge variant={preference.emailAllowed ? preference.emailMode === "off" ? "neutral" : "info" : "warning"}>{preference.emailAllowed ? preference.emailMode.replaceAll("_", " ") : "in-app only"}</Badge>
                  </div>
                  <p className="mt-1 wrap-value text-sm text-[var(--muted)]">{preference.description}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{preference.matchingAlertCount} current matches</p>
                </div>
                <NotificationPreferenceForm preference={preference} />
              </article>
            ))}
          </div>
        </WorksheetShell>
        <WorksheetShell
          eyebrow="Email"
          summary={<span>{inbox.deliveryHistory.length} recent jobs</span>}
          title="Delivery history"
        >
          {inbox.deliveryHistory.length ? (
            <div className="row-list">
              {inbox.deliveryHistory.map((delivery) => (
                <div className="grid min-w-0 gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(10rem,1fr)_8rem_8rem_10rem_minmax(0,1fr)]" key={delivery.id}>
                  <span className="font-medium text-[var(--ink)]">{delivery.categoryKey.replaceAll("_", " ")}</span>
                  <Badge variant={delivery.status === "delivered" ? "success" : delivery.status === "failed" ? "danger" : delivery.status === "cancelled" ? "neutral" : "info"}>{delivery.status}</Badge>
                  <span>{delivery.kind}</span>
                  <span>{formatDate(delivery.deliveredAt ?? delivery.scheduledFor)}</span>
                  <span className="wrap-value text-[var(--muted)]">{delivery.lastError ?? `${delivery.attemptCount} attempt${delivery.attemptCount === 1 ? "" : "s"}`}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-6 text-sm text-[var(--muted)]">No email delivery jobs yet.</p>
          )}
        </WorksheetShell>
      </div>
    </AppShell>
  );
}
