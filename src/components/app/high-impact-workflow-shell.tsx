import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

type ContextItem = {
  label: string;
  value: ReactNode;
};

export function HighImpactWorkflowShell({
  backHref,
  backLabel,
  children,
  context,
  description,
  title,
}: {
  backHref: string;
  backLabel: string;
  children: ReactNode;
  context: ContextItem[];
  description: string;
  title: string;
}) {
  return (
    <section aria-label={title} className="high-impact-workflow" data-testid="high-impact-workflow">
      <header className="high-impact-workflow-header">
        <Link className="table-action inline-flex min-h-11 items-center gap-2" href={backHref}>
          <ArrowLeft aria-hidden="true" size={16} /> {backLabel}
        </Link>
        <div className="mt-4 flex min-w-0 items-start gap-3">
          <span className="high-impact-workflow-icon"><ShieldAlert aria-hidden="true" size={20} /></span>
          <div className="min-w-0">
            <p className="section-kicker">High-impact workflow</p>
            <h1 className="wrap-value font-display text-2xl font-semibold text-[var(--ink)]">{title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--muted-strong)]">{description}</p>
          </div>
        </div>
      </header>
      <dl className="high-impact-context">
        {context.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
      </dl>
      <section className="high-impact-workflow-body">{children}</section>
    </section>
  );
}
