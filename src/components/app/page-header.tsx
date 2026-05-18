import { Badge } from "@/components/ui/badge";

type PageHeaderProps = {
  title: string;
  description: string;
  eyebrow?: string;
  badgeLabel?: string;
};

export function PageHeader({ title, description, eyebrow, badgeLabel }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-[var(--line)] pb-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted)]">{eyebrow}</p> : null}
        <h1 className="font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)] md:text-3xl">
          {title}
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">{description}</p>
      </div>
      {badgeLabel ? (
        <div className="shrink-0">
          <Badge variant="info">{badgeLabel}</Badge>
        </div>
      ) : null}
    </header>
  );
}
