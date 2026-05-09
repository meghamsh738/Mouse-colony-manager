import { Badge } from "@/components/ui/badge";

type PageHeaderProps = {
  title: string;
  description: string;
  eyebrow?: string;
  badgeLabel?: string;
};

export function PageHeader({ title, description, eyebrow, badgeLabel }: PageHeaderProps) {
  return (
    <header className="relative flex flex-col gap-4 overflow-hidden rounded-[32px] border border-[var(--line)] bg-[linear-gradient(135deg,rgba(255,252,245,0.96),rgba(244,238,225,0.78))] p-6 shadow-[0_18px_50px_rgba(34,31,22,0.08)] ring-1 ring-white/50 md:p-7">
      <div className="pointer-events-none absolute -right-20 -top-28 h-64 w-64 rounded-full bg-[rgba(7,92,73,0.1)] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-12 h-56 w-56 rounded-full bg-[rgba(169,100,16,0.12)] blur-3xl" />
      <div className="flex flex-wrap items-center gap-3">
        {eyebrow ? <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">{eyebrow}</p> : null}
        {badgeLabel ? <Badge variant="info">{badgeLabel}</Badge> : null}
      </div>
      <div className="relative max-w-3xl space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)] md:text-4xl">
          {title}
        </h1>
        <p className="text-sm leading-7 text-[var(--muted)] md:text-base">{description}</p>
      </div>
    </header>
  );
}
