import { Badge } from "@/components/ui/badge";

type Stat = {
  label: string;
  value: string | number;
  hint: string;
  emphasis?: "neutral" | "warning" | "danger" | "success" | "info";
};

export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[0_8px_20px_rgba(34,31,22,0.04)] ring-1 ring-white/45"
          data-testid={`stat-${stat.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`}
        >
          <div className="flex min-h-8 items-start justify-between gap-2">
            <p className="line-clamp-2 min-w-0 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">{stat.label}</p>
            <Badge className="shrink-0" variant={stat.emphasis ?? "neutral"}>
              {stat.emphasis ?? "live"}
            </Badge>
          </div>
          <p className="mt-3 font-display text-2xl font-semibold tracking-[-0.05em] text-[var(--ink)]">{stat.value}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{stat.hint}</p>
        </div>
      ))}
    </section>
  );
}
