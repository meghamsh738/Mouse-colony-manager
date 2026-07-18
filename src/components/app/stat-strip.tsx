type Stat = {
  label: string;
  value: string | number;
  hint?: string;
  emphasis?: "neutral" | "warning" | "danger" | "success" | "info";
};

export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <section className="stat-strip" aria-label="Colony metrics">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="stat-strip-item"
          data-testid={`stat-${stat.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`}
          data-emphasis={stat.emphasis ?? "neutral"}
        >
          <p className="stat-strip-value">{stat.value}</p>
          <div className="min-w-0">
            <p className="stat-strip-label">{stat.label}</p>
            {stat.hint ? <p className="stat-strip-hint">{stat.hint}</p> : null}
          </div>
        </div>
      ))}
    </section>
  );
}
