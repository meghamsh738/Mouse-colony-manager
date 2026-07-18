import Link from "next/link";
import {
  Activity,
  BellRing,
  BookOpen,
  BookOpenCheck,
  Building2,
  Boxes,
  ChevronDown,
  CircleUserRound,
  FlaskConical,
  Home,
  LineChart,
  LogOut,
  QrCode,
  Receipt,
  Search,
  Settings2,
  ShieldAlert,
  Snowflake,
  Table2,
  TestTubeDiagonal,
  Users,
  Wrench,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";

import { signOut } from "@/auth";
import { ActiveLabSwitcher } from "@/components/app/active-lab-switcher";
import { EmptyProfileSwitcher } from "@/components/app/empty-profile-switcher";
import { getAppShellStatusView } from "@/lib/app-shell-read";
import { canonicalRoleLabel } from "@/lib/capabilities";
import { isEmptyProfileSwitcherEnabled } from "@/lib/empty-profile-switch";
import { getNavigationForActor } from "@/lib/navigation";
import type { NavigationItemId } from "@/lib/navigation";
import { resolveCurrentActor } from "@/lib/session";
import { cn } from "@/lib/utils";

const navigationIcons: Record<NavigationItemId, LucideIcon> = {
  dashboard: Home,
  scan: QrCode,
  animals: Table2,
  cages: Boxes,
  quarantine: ShieldAlert,
  breeding: Activity,
  experiments: FlaskConical,
  procedures: Wrench,
  sops: BookOpenCheck,
  biosamples: TestTubeDiagonal,
  forecast: LineChart,
  cryostorage: Snowflake,
  approvals: ClipboardCheck,
  billing: Receipt,
  notifications: BellRing,
  workbook: BookOpen,
  rules: Settings2,
  labs: Building2,
  users: Users,
  system: Wrench,
};

function isActivePath(currentPath: string, href: string) {
  if (href === "/") {
    return currentPath === href;
  }

  return currentPath === href || currentPath.startsWith(`${href}/`);
}

type AppShellProps = {
  currentPath: string;
  userName: string;
  role: string;
  children: React.ReactNode;
};

export async function AppShell({ currentPath, userName, role, children }: AppShellProps) {
  const actor = await resolveCurrentActor();
  const navigation = actor ? getNavigationForActor(actor) : [];
  const mobilePrimaryNavigation = navigation.filter((item) => item.mobilePrimary).slice(0, 4);
  const mobileSecondaryNavigation = navigation.filter((item) => !mobilePrimaryNavigation.includes(item));
  const status = await getAppShellStatusView(actor);
  const profileSwitcherEnabled = isEmptyProfileSwitcherEnabled(
    process.env.NODE_ENV,
    process.env.EMPTY_PROFILE_SWITCHER,
  );
  const alertCountLabel = status.openAlerts === 1 ? "1 open alert" : `${status.openAlerts} open alerts`;
  const alertLabel = status.degraded ? "Alerts offline" : alertCountLabel;
  const roleLabel = actor ? canonicalRoleLabel(actor.canonicalRole) : role.replaceAll("_", " ");
  const accountSummary = profileSwitcherEnabled ? userName : roleLabel;

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="app-frame min-h-screen text-[var(--ink)]">
      <aside className="sidebar-rail fixed inset-y-0 left-0 z-40 hidden w-[216px] overflow-y-auto lg:block">
        <div className="sidebar-rail-content flex min-h-full flex-col">
          <Link className="sidebar-brand" href="/" aria-label="Mouse Colony Manager dashboard">
            <span className="sidebar-brand-mark">MM</span>
            <span className="min-w-0">
              <span className="block truncate text-xs text-white/62">Mouse Colony</span>
              <span className="block truncate text-[0.95rem] font-semibold text-white">Manager</span>
            </span>
          </Link>

          <nav className="sidebar-navigation" aria-label="Main navigation">
            {navigation.map((item, index) => {
              const Icon = navigationIcons[item.id];
              const isActive = isActivePath(currentPath, item.href);
              const previousGroup = index > 0 ? navigation[index - 1]?.group : null;
              const startsGroup = previousGroup !== item.group;

              return (
                <div key={item.href} className={cn(startsGroup && index > 0 && "sidebar-group-start")}>
                  {startsGroup ? <p className="sidebar-group-label">{item.group}</p> : null}
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn("sidebar-link", isActive && "is-active")}
                  >
                    <Icon className="h-[17px] w-[17px] shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.href === "/notifications" && status.openAlerts > 0 ? (
                      <span className="sidebar-alert-count">{status.openAlerts}</span>
                    ) : null}
                  </Link>
                </div>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="flex items-center gap-2 text-xs text-white/65">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  status.degraded ? "bg-amber-400" : "bg-emerald-400",
                )}
              />
              {status.degraded ? "Service check needed" : "Systems operational"}
            </div>
            <div className="mt-3 min-w-0">
              <p className="truncate text-sm font-medium text-white">{userName}</p>
              <p className="truncate text-xs text-white/55">{roleLabel}</p>
              {actor?.canonicalRole === "lab_user" && actor.activeMembership ? (
                <p className="mt-1 truncate text-xs text-white/45">{actor.activeMembership.labName}</p>
              ) : null}
            </div>
            <form action={signOutAction} className="mt-3">
              <button className="sidebar-signout" type="submit">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="flex min-h-screen min-w-0 flex-col lg:pl-[216px]">
        <header className="mobile-app-header lg:hidden">
          <Link className="mobile-brand min-h-11" href="/">
            <span className="mobile-brand-mark">MM</span>
            <span className="min-w-0">
              <span className="block truncate text-xs text-[var(--muted)]">Mouse Colony</span>
              <span className="block truncate text-sm font-semibold">Manager</span>
            </span>
          </Link>
          <div className="flex items-center gap-1.5">
            {navigation.some((item) => item.id === "notifications") ? <Link className="icon-button relative !h-11 !w-11" href="/notifications" aria-label={alertLabel}>
              <BellRing className="h-5 w-5" aria-hidden="true" />
              {status.openAlerts > 0 ? <span className="notification-dot">{status.openAlerts}</span> : null}
            </Link> : null}
            <details className="user-menu">
              <summary className="icon-button !h-11 !w-11 list-none [&::-webkit-details-marker]:hidden" aria-label="Account menu">
                <CircleUserRound className="h-5 w-5" aria-hidden="true" />
              </summary>
              <div className="user-menu-panel">
                <p className="truncate text-sm font-semibold">{userName}</p>
                <p className="truncate text-xs text-[var(--muted)]">{roleLabel}</p>
                {actor?.canonicalRole === "lab_user" ? (
                  <div className="mt-3 border-t border-[var(--line)] pt-3">
                    <ActiveLabSwitcher activeLabId={actor.activeLabId} memberships={actor.memberships} />
                  </div>
                ) : null}
                {profileSwitcherEnabled ? (
                  <EmptyProfileSwitcher currentUserId={actor?.id} />
                ) : null}
                <form action={signOutAction} className="mt-3 border-t border-[var(--line)] pt-3">
                  <button className="table-action !min-h-11 w-full justify-start" type="submit">
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>

        <header className="desktop-command-header hidden lg:flex">
          {navigation.some((item) => item.id === "notifications") ? <Link
            className={cn("global-alert-link", status.degraded && "is-warning")}
            href="/notifications"
          >
            <span className="global-alert-dot" aria-hidden="true" />
            <span>{status.degraded ? "Alerts unavailable" : alertCountLabel}</span>
          </Link> : <span className="text-xs text-[var(--muted)]">{roleLabel}</span>}
          {navigation.some((item) => item.id === "animals") ? <form action="/animals" method="get" className="global-search-form">
            <Search className="h-4 w-4 text-[var(--muted)]" aria-hidden="true" />
            <input
              aria-label="Search animals"
              name="search"
              placeholder="Search animal ID, lab ID, strain, or cage"
              type="search"
            />
            <button className="icon-button h-8 w-8" type="submit" aria-label="Search">
              <Search className="h-4 w-4" aria-hidden="true" />
            </button>
          </form> : <div className="flex-1" />}
          {navigation.some((item) => item.id === "scan") ? <Link className="header-scan-action" href="/scan">
            <QrCode className="h-4 w-4" aria-hidden="true" />
            Scan cage
          </Link> : null}
          {navigation.some((item) => item.id === "workbook") ? <Link className={cn("header-workbook-action", currentPath === "/workbook" && "is-active")} href="/workbook">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            Workbook
          </Link> : null}
          <details className="user-menu">
            <summary className="desktop-user-summary list-none [&::-webkit-details-marker]:hidden">
              <CircleUserRound className="h-5 w-5" aria-hidden="true" />
              <span className="max-w-32 truncate">{accountSummary}</span>
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </summary>
            <div className="user-menu-panel right-0">
              <p className="truncate text-sm font-semibold">{userName}</p>
              <p className="truncate text-xs text-[var(--muted)]">{roleLabel}</p>
              {actor?.canonicalRole === "lab_user" ? (
                <div className="mt-3 border-t border-[var(--line)] pt-3">
                  <ActiveLabSwitcher activeLabId={actor.activeLabId} memberships={actor.memberships} />
                </div>
              ) : null}
              {profileSwitcherEnabled ? (
                <EmptyProfileSwitcher currentUserId={actor?.id} />
              ) : null}
              <form action={signOutAction} className="mt-3 border-t border-[var(--line)] pt-3">
                <button className="table-action w-full justify-start" type="submit">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </header>

        <div className="app-main-content flex-1 px-4 py-5 md:px-6 lg:px-7 lg:py-6">
          <div className="app-content-wide">{children}</div>
        </div>

        <nav className="mobile-bottom-nav lg:hidden" aria-label="Mobile navigation">
          {mobilePrimaryNavigation.map((item) => {
            const Icon = navigationIcons[item.id];
            const isActive = isActivePath(currentPath, item.href);
            const isScan = item.href === "/scan";

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn("mobile-bottom-link", isActive && "is-active", isScan && "is-scan")}
              >
                <span className="mobile-bottom-icon">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
          <details className="mobile-more-menu">
            <summary className={cn("mobile-bottom-link list-none [&::-webkit-details-marker]:hidden", (currentPath === "/workbook" || mobileSecondaryNavigation.some((item) => isActivePath(currentPath, item.href))) && "is-active") }>
              <span className="mobile-bottom-icon relative">
                <ChevronDown className="h-5 w-5" aria-hidden="true" />
                {status.openAlerts > 0 ? <span className="mobile-more-dot" /> : null}
              </span>
              <span>More</span>
            </summary>
            <div className="mobile-more-panel">
              {mobileSecondaryNavigation.map((item) => {
                const Icon = navigationIcons[item.id];
                const isActive = isActivePath(currentPath, item.href);

                return (
                  <Link
                    className={cn("mobile-more-link", isActive && "is-active")}
                    href={item.href}
                    key={item.href}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{item.label}</span>
                    {item.href === "/notifications" && status.openAlerts > 0 ? (
                      <span className="ml-auto text-xs font-semibold text-[var(--danger)]">{status.openAlerts}</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </details>
        </nav>
      </main>
    </div>
  );
}
