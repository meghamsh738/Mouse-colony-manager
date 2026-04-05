import { Badge } from "@/components/ui/badge";

type PageHeaderProps = {
  title: string;
  description: string;
  eyebrow?: string;
  badgeLabel?: string;
};

export function PageHeader({ title, description, eyebrow, badgeLabel }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-6">
      <div className="flex flex-wrap items-center gap-3">
        {eyebrow ? <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">{eyebrow}</p> : null}
        {badgeLabel ? <Badge variant="info">{badgeLabel}</Badge> : null}
      </div>
      <div className="max-w-3xl space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)] md:text-4xl">
          {title}
        </h1>
        <p className="text-sm leading-7 text-[var(--muted)] md:text-base">{description}</p>
      </div>
    </header>
  );
}
