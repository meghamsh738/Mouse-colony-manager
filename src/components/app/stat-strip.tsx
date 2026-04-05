import { Badge } from "@/components/ui/badge";

type Stat = {
  label: string;
  value: string | number;
  hint: string;
  emphasis?: "neutral" | "warning" | "danger" | "success" | "info";
};

export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <section className="grid gap-4 border-y border-[var(--line)] py-5 md:grid-cols-3 xl:grid-cols-6">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="space-y-2"
          data-testid={`stat-${stat.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">{stat.label}</p>
            <Badge variant={stat.emphasis ?? "neutral"}>{stat.emphasis ?? "live"}</Badge>
          </div>
          <p className="font-display text-3xl font-semibold tracking-[-0.05em] text-[var(--ink)]">{stat.value}</p>
          <p className="text-sm text-[var(--muted)]">{stat.hint}</p>
        </div>
      ))}
    </section>
  );
}
