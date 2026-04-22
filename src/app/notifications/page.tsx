import Link from "next/link";

import { NotificationFeed } from "@/components/app/notification-feed";
import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { StatStrip } from "@/components/app/stat-strip";
import { Surface } from "@/components/app/surface";
import { Badge } from "@/components/ui/badge";
import { getNotificationInboxView } from "@/lib/notifications-read";
import { requireUser } from "@/lib/session";

export default async function NotificationsPage() {
  const user = await requireUser();
  const inbox = await getNotificationInboxView();

  return (
    <AppShell currentPath="/notifications" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Notifications"
          title="In-app notification inbox for the active colony."
          description="Selected alert categories become an operator inbox here. Admins can mute or re-enable each notification stream from the rules workspace without changing source code."
          badgeLabel="in-app delivery"
        />
        <StatStrip
          stats={[
            { label: "Active notifications", value: inbox.summary.total, hint: "Enabled in-app items currently in the inbox", emphasis: "danger" },
            { label: "Critical", value: inbox.summary.critical, hint: "Need immediate review", emphasis: "danger" },
            { label: "Warnings", value: inbox.summary.warning, hint: "Require near-term action", emphasis: "warning" },
            { label: "Info", value: inbox.summary.info, hint: "Non-blocking operational reminders", emphasis: "info" },
            { label: "Enabled categories", value: inbox.summary.enabledCategories, hint: "Notification streams currently delivered", emphasis: "success" },
            { label: "Muted categories", value: inbox.summary.mutedCategories, hint: "Suppressed until re-enabled in rules", emphasis: "neutral" },
          ]}
        />
        <div className="grid gap-6 xl:grid-cols-[1.18fr_0.82fr]">
          <NotificationFeed inbox={inbox} />
          <div className="space-y-6">
            <Surface className="space-y-5">
              <div className="flex items-end justify-between gap-3 border-b border-[var(--line)] pb-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Delivery controls</p>
                  <h2 className="font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">Category coverage</h2>
                </div>
                <Link className="text-sm font-medium text-[var(--accent)]" href="/settings">
                  Open rules
                </Link>
              </div>
              <div className="space-y-3">
                {inbox.preferences.map((preference) => (
                  <article
                    key={preference.ruleKey}
                    className="rounded-[24px] border border-[var(--line)] bg-white/70 p-4"
                    data-testid={`notification-preference-${preference.categoryKey}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-[var(--ink)]">{preference.categoryLabel}</p>
                        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{preference.description}</p>
                      </div>
                      <Badge variant={preference.enabled ? "success" : "neutral"}>
                        {preference.enabled ? "enabled" : "muted"}
                      </Badge>
                    </div>
                    <p className="mt-3 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                      {preference.matchingAlertCount} matching {preference.matchingAlertCount === 1 ? "alert" : "alerts"}
                    </p>
                  </article>
                ))}
              </div>
            </Surface>
            <Surface className="space-y-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">How to use this</p>
              <div className="space-y-3 text-sm leading-7 text-[var(--muted)]">
                <p>Use this page as the operational queue for age-sensitive genotype follow-up, overdue litters, breeder review, welfare follow-up, and experiment reservation drift.</p>
                <p>Each notification links back to the working surface where the issue can be resolved. If a whole category is too noisy, mute that stream in the rules page instead of ignoring the inbox.</p>
              </div>
            </Surface>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
