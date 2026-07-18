import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type WorksheetShellProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  eyebrow?: string;
  summary?: ReactNode;
  title?: string;
  toolbar?: ReactNode;
};

export function WorksheetShell({
  actions,
  children,
  className,
  eyebrow,
  summary,
  title,
  toolbar,
}: WorksheetShellProps) {
  return (
    <section className={cn("worksheet-shell", className)}>
      {title || eyebrow || summary || actions ? (
        <div className="worksheet-header">
          <div className="min-w-0">
            {eyebrow ? <p className="metadata-label">{eyebrow}</p> : null}
            {title ? (
              <h2 className="wrap-value font-display text-base font-semibold text-[var(--ink)] md:text-lg">
                {title}
              </h2>
            ) : null}
            {summary ? <div className="metadata-line mt-1">{summary}</div> : null}
          </div>
          {actions ? <div className="worksheet-header-actions">{actions}</div> : null}
        </div>
      ) : null}
      {toolbar ? <div className="worksheet-toolbar">{toolbar}</div> : null}
      <div className="worksheet-body">{children}</div>
    </section>
  );
}

type RowActionMenuProps = {
  children: ReactNode;
  className?: string;
  label?: string;
  tone?: "default" | "danger" | "warning";
};

export function RowActionMenu({ children, className, label = "Actions", tone = "default" }: RowActionMenuProps) {
  return (
    <details className={cn("row-action-menu", tone !== "default" && `row-action-menu-${tone}`, className)}>
      <summary>{label}</summary>
      <div className="row-action-menu-panel">{children}</div>
    </details>
  );
}

type MobileWorksheetCardProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  meta?: ReactNode;
  title: ReactNode;
};

export function MobileWorksheetCard({ actions, children, className, meta, title }: MobileWorksheetCardProps) {
  return (
    <article className={cn("mobile-worksheet-card", className)}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="wrap-value text-[0.95rem] font-semibold text-[var(--ink)]">{title}</div>
          {meta ? <div className="metadata-line mt-1">{meta}</div> : null}
        </div>
        {actions ? <div className="action-row justify-end">{actions}</div> : null}
      </div>
      <div className="mobile-worksheet-fields">{children}</div>
    </article>
  );
}

type EditableCellProps = {
  children: ReactNode;
  className?: string;
  label?: string;
  state?: "idle" | "pending" | "saved" | "error";
};

export function EditableCell({ children, className, label, state = "idle" }: EditableCellProps) {
  return (
    <div className={cn("editable-cell", `editable-cell-${state}`, className)}>
      {label ? <span className="sr-only">{label}</span> : null}
      {children}
    </div>
  );
}
