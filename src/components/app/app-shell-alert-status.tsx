import Link from "next/link";
import { BellRing } from "lucide-react";

import { getAppShellStatusView } from "@/lib/app-shell-read";
import type { ResolvedActor } from "@/lib/session";
import { cn } from "@/lib/utils";

type AppShellAlertStatusProps = {
  actor: ResolvedActor | null;
};

export async function SidebarNotificationBadge({ actor }: AppShellAlertStatusProps) {
  const status = await getAppShellStatusView(actor);

  return status.openAlerts > 0 ? <span className="sidebar-alert-count">{status.openAlerts}</span> : null;
}

export async function SidebarServiceStatus({ actor }: AppShellAlertStatusProps) {
  const status = await getAppShellStatusView(actor);

  return (
    <div className="flex items-center gap-2 text-xs text-white/65">
      <span className={cn("h-2 w-2 rounded-full", status.degraded ? "bg-amber-400" : "bg-emerald-400")} />
      {status.degraded ? "Service check needed" : "Systems operational"}
    </div>
  );
}

export async function MobileNotificationLink({ actor }: AppShellAlertStatusProps) {
  const status = await getAppShellStatusView(actor);
  const alertCountLabel = status.openAlerts === 1 ? "1 open alert" : `${status.openAlerts} open alerts`;
  const alertLabel = status.degraded ? "Alerts offline" : alertCountLabel;

  return (
    <Link className="icon-button relative !h-11 !w-11" href="/notifications" aria-label={alertLabel}>
      <BellRing className="h-5 w-5" aria-hidden="true" />
      {status.openAlerts > 0 ? <span className="notification-dot">{status.openAlerts}</span> : null}
    </Link>
  );
}

export async function DesktopAlertLink({ actor }: AppShellAlertStatusProps) {
  const status = await getAppShellStatusView(actor);
  const alertCountLabel = status.openAlerts === 1 ? "1 open alert" : `${status.openAlerts} open alerts`;

  return (
    <Link className={cn("global-alert-link", status.degraded && "is-warning")} href="/notifications">
      <span className="global-alert-dot" aria-hidden="true" />
      <span>{status.degraded ? "Alerts unavailable" : alertCountLabel}</span>
    </Link>
  );
}

export async function MobileMoreAlertDot({ actor }: AppShellAlertStatusProps) {
  const status = await getAppShellStatusView(actor);

  return status.openAlerts > 0 ? <span className="mobile-more-dot" /> : null;
}

export async function MobileMoreAlertCount({ actor }: AppShellAlertStatusProps) {
  const status = await getAppShellStatusView(actor);

  return status.openAlerts > 0
    ? <span className="ml-auto text-xs font-semibold text-[var(--danger)]">{status.openAlerts}</span>
    : null;
}
