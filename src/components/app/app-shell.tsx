import Link from "next/link";
import { Activity, Boxes, FlaskConical, Home, LogOut, QrCode, Settings2, Table2 } from "lucide-react";

import { signOut } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getColonyData, getDashboardMetrics, runtimeMode } from "@/lib/colony";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/animals", label: "Colony", icon: Table2 },
  { href: "/cages", label: "Cages", icon: Boxes },
  { href: "/breeding", label: "Breeding", icon: Activity },
  { href: "/experiments", label: "Experiments", icon: FlaskConical },
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
  await getColonyData();
  const metrics = getDashboardMetrics();

  return (
    <div className="min-h-screen bg-[var(--page)] text-[var(--ink)]">
      <div className="mx-auto grid min-h-screen w-full max-w-[1600px] lg:grid-cols-[272px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[var(--line)] bg-[var(--nav)] px-6 py-8 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:justify-between">
          <div className="space-y-8">
            <div className="space-y-5">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-[var(--hero)] text-[var(--hero-ink)]">
                <span className="font-display text-xl font-semibold tracking-[-0.05em]">MM</span>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Mouse Colony Manager</p>
                <h1 className="font-display text-2xl font-semibold tracking-[-0.05em]">Mouse colony workspace</h1>
                <p className="text-sm leading-6 text-[var(--muted)]">
                  Cage-first operations for staff and lineage-safe animal records for researchers.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="info">{runtimeMode}</Badge>
                <Badge variant="neutral">{metrics.openAlerts} open alerts</Badge>
              </div>
            </div>
            <nav className="space-y-1 border-t border-[var(--line)] pt-5">
              {navigation.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border border-transparent px-4 py-3 text-sm transition-colors",
                      currentPath === item.href
                        ? "border-[var(--line)] bg-white/70 text-[var(--ink)]"
                        : "text-[var(--muted)] hover:border-[var(--line)] hover:bg-white/50 hover:text-[var(--ink)]",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="space-y-4 border-t border-[var(--line)] pt-5">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Signed in</p>
              <p className="font-medium">{userName}</p>
              <p className="text-sm text-[var(--muted)]">{role.replaceAll("_", " ")}</p>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button className="w-full justify-between" variant="subtle">
                Sign out
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </aside>
        <main className="flex min-h-screen flex-col">
          <div className="border-b border-[var(--line)] bg-[var(--surface)]/90 px-5 py-4 backdrop-blur-sm lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Mouse Colony Manager</p>
                <p className="font-display text-xl font-semibold tracking-[-0.05em]">Colony workspace</p>
              </div>
              <Badge variant="info">{metrics.openAlerts} alerts</Badge>
            </div>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
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
          <div className="flex-1 px-5 py-6 md:px-8 md:py-8 lg:px-10 lg:py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
