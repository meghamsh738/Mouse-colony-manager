import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

type PageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  badgeLabel?: string;
  breadcrumbs?: Array<{
    href?: string;
    label: string;
  }>;
  actions?: ReactNode;
};

export function PageHeader({ title, description, eyebrow, badgeLabel, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        {breadcrumbs?.length ? (
          <nav aria-label="Breadcrumb" className="page-breadcrumbs">
            {breadcrumbs.map((crumb, index) => (
              <span className="inline-flex min-w-0 items-center gap-1.5" key={`${crumb.label}-${index}`}>
                {index > 0 ? <span aria-hidden="true">›</span> : null}
                {crumb.href ? (
                  <Link className="wrap-value hover:text-[var(--accent)]" href={crumb.href}>
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="wrap-value text-[var(--muted-strong)]">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : eyebrow ? (
          <p className="page-context">{eyebrow}</p>
        ) : null}
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="action-row shrink-0 self-start md:self-center">{actions}</div> : badgeLabel ? (
        <div className="shrink-0 self-start md:self-center">
          <Badge variant="info">{badgeLabel}</Badge>
        </div>
      ) : null}
    </header>
  );
}
