import Link from "next/link";
import { Activity, BellRing, Boxes, FlaskConical, Home, LineChart, LogOut, QrCode, Settings2, ShieldAlert, Snowflake, Table2, TestTubeDiagonal } from "lucide-react";

import { signOut } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAppShellStatusView } from "@/lib/app-shell-read";
import { runtimeMode } from "@/lib/runtime";
import { cn } from "@/lib/utils";

const navigation = [
  {
    href: "/",
    label: "Dashboard",
    icon: Home,
    help: "Daily command center with colony counts, alerts, litter queue, composition, and breeding suggestions.",
  },
  {
    href: "/animals",
    label: "Colony",
    icon: Table2,
    help: "Search active mice, add animals, review status, export filtered lists, and open detailed records.",
  },
  {
    href: "/cages",
    label: "Cages",
    icon: Boxes,
    help: "Review cage locations, occupancy, sex mix, strain summaries, warnings, and cage detail workspaces.",
  },
  {
    href: "/breeding",
    label: "Breeding",
    icon: Activity,
    help: "Manage breeding pairs, record litters and weaning, and compare suggested crosses with risk warnings.",
  },
  {
    href: "/experiments",
    label: "Experiments",
    icon: FlaskConical,
    help: "Plan balanced cohorts, save assignments, update or remove planned entries, and resolve conflicts.",
  },
  {
    href: "/samples",
    label: "Samples",
    icon: TestTubeDiagonal,
    help: "Record tissues or DNA, track storage, search by animal or project, and audit sample history.",
  },
  {
    href: "/cryostorage",
    label: "Cryostorage",
    icon: Snowflake,
    help: "Track frozen embryos, sperm, backup lines, recovery notes, locations, and archive status.",
  },
  {
    href: "/forecast",
    label: "Forecast",
    icon: LineChart,
    help: "Compare demand against available mice, projected litters, surplus risk, and line-specific runway.",
  },
  {
    href: "/notifications",
    label: "Notifications",
    icon: BellRing,
    help: "Review in-app alerts, follow action links, and manage delivery preferences for colony events.",
  },
  {
    href: "/quarantine",
    label: "Quarantine",
    icon: ShieldAlert,
    help: "Monitor quarantine cages, sentinel status, unresolved welfare notes, and follow-up pressure.",
  },
  {
    href: "/scan",
    label: "Scan",
    icon: QrCode,
    help: "Open cage workspaces from barcode input, then log welfare notes or husbandry actions quickly.",
  },
  {
    href: "/settings",
    label: "Rules",
    icon: Settings2,
    help: "Tune admin thresholds, edit operational rules, and review audit entries for configuration changes.",
  },
];

function isActivePath(currentPath: string, href: string) {
  if (href === "/") {
    return currentPath === href;
  }

  return currentPath === href || currentPath.startsWith(`${href}/`);
}

function getNavigationHelpId(href: string, scope: "desktop" | "mobile") {
  const slug = href === "/" ? "dashboard" : href.replaceAll("/", "-").replace(/^-/, "");

  return `nav-help-${scope}-${slug}`;
}

function NavigationHelp({
  help,
  href,
  label,
  scope,
}: {
  help: string;
  href: string;
  label: string;
  scope: "desktop" | "mobile";
}) {
  const helpId = getNavigationHelpId(href, scope);

  return (
    <span className={cn("nav-help", scope === "mobile" && "nav-help-mobile")}>
      <span
        aria-describedby={helpId}
        aria-label={`${label} help: ${help}`}
        className="nav-help-trigger"
        tabIndex={0}
        title={help}
      >
        ?
      </span>
      <span className="nav-help-card" id={helpId} role="tooltip">
        <span className="nav-help-title">{label}</span>
        <span>{help}</span>
      </span>
    </span>
  );
}

type AppShellProps = {
  currentPath: string;
  userName: string;
  role: string;
  children: React.ReactNode;
};

export async function AppShell({ currentPath, userName, role, children }: AppShellProps) {
  const status = await getAppShellStatusView();

  return (
    <div className="min-h-screen overflow-x-hidden text-[var(--ink)]">
      <aside className="sidebar-rail fixed inset-y-0 left-0 z-30 hidden w-[236px] overflow-y-auto text-[var(--hero-ink)] lg:block xl:w-[248px]">
        <div className="sidebar-rail-content flex min-h-full flex-col justify-between px-3 py-4">
          <div className="space-y-4">
            <div className="space-y-4 px-1">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/12 bg-white/10 text-[var(--hero-ink)]">
                  <span className="font-display text-base font-semibold tracking-[-0.05em]">MM</span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[0.66rem] uppercase tracking-[0.18em] text-white/55">Mouse Colony</p>
                  <p className="truncate font-display text-base font-semibold tracking-[-0.04em]">Manager</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-white/10 bg-white/8 px-2.5 py-2">
                  <p className="text-[0.62rem] uppercase tracking-[0.14em] text-white/45">Runtime</p>
                  <p className="mt-1 truncate text-xs font-medium">{runtimeMode}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/8 px-2.5 py-2">
                  <p className="text-[0.62rem] uppercase tracking-[0.14em] text-white/45">Alerts</p>
                  <p className="mt-1 text-xs font-medium">{status.openAlerts} open</p>
                </div>
              </div>
            </div>
            <nav className="space-y-0.5 border-t border-white/10 pt-3" aria-label="Main navigation">
              {navigation.map((item) => {
                const Icon = item.icon;
                const isActive = isActivePath(currentPath, item.href);

                return (
                  <div
                    key={item.href}
                    className={cn(
                      "group relative flex items-center gap-1 rounded-xl border border-transparent pr-1 text-sm font-medium transition",
                      isActive
                        ? "border-white/12 bg-white/14 text-white"
                        : "text-white/68 hover:border-white/10 hover:bg-white/8 hover:text-white",
                    )}
                  >
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2.5"
                    >
                      <Icon className="h-4 w-4 shrink-0 transition group-hover:scale-105" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                    <NavigationHelp help={item.help} href={item.href} label={item.label} scope="desktop" />
                  </div>
                );
              })}
            </nav>
          </div>
          <div className="mt-4 space-y-3 border-t border-white/10 px-1 pt-4">
            <div className="space-y-1">
              <p className="text-[0.66rem] uppercase tracking-[0.16em] text-white/50">Signed in</p>
              <p className="truncate text-sm font-medium">{userName}</p>
              <p className="truncate text-xs text-white/62">{role.replaceAll("_", " ")}</p>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button className="h-10 w-full justify-between border-white/10 bg-white/10 text-white hover:bg-white/15" variant="subtle">
                Sign out
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </aside>
      <main className="flex min-h-screen min-w-0 flex-col overflow-x-hidden lg:pl-[236px] xl:pl-[248px]">
          <div className="border-b border-[var(--line)] bg-[var(--surface)]/90 px-5 py-4 backdrop-blur-sm lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Mouse Colony Manager</p>
                <p className="font-display text-xl font-semibold tracking-[-0.05em]">Colony workspace</p>
              </div>
              <Badge variant="info">{status.openAlerts} alerts</Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 min-[380px]:grid-cols-3">
              {navigation.map((item) => (
                <div key={item.href} className="relative min-w-0">
                  <Link
                    href={item.href}
                    className={cn(
                      "flex min-h-9 items-center justify-center rounded-full px-3 py-2 pr-8 text-center text-sm leading-none",
                      isActivePath(currentPath, item.href)
                        ? "bg-[var(--hero)] text-[var(--hero-ink)]"
                        : "border border-[var(--line)] bg-white/70 text-[var(--muted)]",
                    )}
                  >
                    <span className="truncate">{item.label}</span>
                  </Link>
                  <NavigationHelp help={item.help} href={item.href} label={item.label} scope="mobile" />
                </div>
              ))}
            </div>
          </div>
          <div className="hidden items-center justify-between border-b border-[var(--line)] bg-[rgba(255,252,245,0.62)] px-8 py-4 backdrop-blur lg:flex">
            <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
              <span>Postgres runtime</span>
              <span className="text-[var(--line-strong)]">/</span>
              <span>{status.openAlerts} active alerts</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="neutral">{runtimeMode}</Badge>
              <Badge variant="info">{role.replaceAll("_", " ")}</Badge>
            </div>
          </div>
          <div className="flex-1 px-4 py-5 md:px-6 md:py-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
