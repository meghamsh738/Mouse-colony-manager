import Link from "next/link";
import { Activity, BellRing, Boxes, FlaskConical, Home, LineChart, LogOut, QrCode, Settings2, ShieldAlert, Snowflake, Table2, TestTubeDiagonal } from "lucide-react";

import { signOut } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDashboardMetricsView } from "@/lib/dashboard-read";
import { runtimeMode } from "@/lib/runtime";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/animals", label: "Colony", icon: Table2 },
  { href: "/cages", label: "Cages", icon: Boxes },
  { href: "/breeding", label: "Breeding", icon: Activity },
  { href: "/experiments", label: "Experiments", icon: FlaskConical },
  { href: "/samples", label: "Samples", icon: TestTubeDiagonal },
  { href: "/cryostorage", label: "Cryostorage", icon: Snowflake },
  { href: "/forecast", label: "Forecast", icon: LineChart },
  { href: "/notifications", label: "Notifications", icon: BellRing },
  { href: "/quarantine", label: "Quarantine", icon: ShieldAlert },
  { href: "/scan", label: "Scan", icon: QrCode },
  { href: "/settings", label: "Rules", icon: Settings2 },
];

type AppShellProps = {
  currentPath: string;
  userName: string;
  role: string;
  children: React.ReactNode;
};

export async function AppShell({ currentPath, userName, role, children }: AppShellProps) {
  const metrics = await getDashboardMetricsView();

  return (
    <div className="min-h-screen overflow-x-hidden text-[var(--ink)]">
      <div className="mx-auto grid min-h-screen w-full max-w-[1680px] lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden bg-[linear-gradient(180deg,var(--nav),var(--nav-2))] px-5 py-6 text-[var(--hero-ink)] shadow-[18px_0_60px_rgba(0,47,38,0.18)] lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:justify-between">
          <div className="space-y-8">
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-[var(--hero-ink)] shadow-[0_1px_0_rgba(255,255,255,0.2)_inset]">
                  <span className="font-display text-xl font-semibold tracking-[-0.05em]">MM</span>
                </div>
                <div>
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-white/55">Mouse Colony</p>
                  <p className="font-display text-lg font-semibold tracking-[-0.04em]">Manager</p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="font-display text-2xl font-semibold tracking-[-0.05em]">Colony workspace</p>
                <p className="text-sm leading-6 text-white/62">
                  Cage-first operations for staff and lineage-safe animal records for researchers.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="border-white/10 bg-white/10 text-white">{runtimeMode}</Badge>
                <Badge variant={metrics.openAlerts > 0 ? "danger" : "success"}>{metrics.openAlerts} open alerts</Badge>
              </div>
            </div>
            <nav className="space-y-1 border-t border-white/10 pt-5">
              {navigation.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-3 rounded-2xl border border-transparent px-4 py-3 text-sm font-medium transition",
                      currentPath === item.href
                        ? "border-white/10 bg-white/14 text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset]"
                        : "text-white/68 hover:border-white/10 hover:bg-white/8 hover:text-white",
                    )}
                  >
                    <Icon className="h-4 w-4 transition group-hover:scale-105" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="space-y-4 border-t border-white/10 pt-5">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.18em] text-white/50">Signed in</p>
              <p className="font-medium">{userName}</p>
              <p className="text-sm text-white/62">{role.replaceAll("_", " ")}</p>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button className="w-full justify-between border-white/10 bg-white/10 text-white hover:bg-white/15" variant="subtle">
                Sign out
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </aside>
        <main className="flex min-h-screen min-w-0 flex-col overflow-x-hidden">
          <div className="border-b border-[var(--line)] bg-[var(--surface)]/90 px-5 py-4 backdrop-blur-sm lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Mouse Colony Manager</p>
                <p className="font-display text-xl font-semibold tracking-[-0.05em]">Colony workspace</p>
              </div>
              <Badge variant="info">{metrics.openAlerts} alerts</Badge>
            </div>
            <div className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-1">
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "whitespace-nowrap rounded-full px-4 py-2 text-sm",
                    currentPath === item.href
                      ? "bg-[var(--hero)] text-[var(--hero-ink)]"
                      : "border border-[var(--line)] bg-white/70 text-[var(--muted)]",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="hidden items-center justify-between border-b border-[var(--line)] bg-[rgba(255,252,245,0.62)] px-8 py-4 backdrop-blur lg:flex">
            <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
              <span>Postgres runtime</span>
              <span className="text-[var(--line-strong)]">/</span>
              <span>{metrics.openAlerts} active alerts</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="neutral">{runtimeMode}</Badge>
              <Badge variant="info">{role.replaceAll("_", " ")}</Badge>
            </div>
          </div>
          <div className="flex-1 px-5 py-6 md:px-8 md:py-8 lg:px-10 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
