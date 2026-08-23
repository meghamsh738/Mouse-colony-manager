"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type CompactActionTone = "default" | "primary" | "warning" | "danger" | "financial";

export type CompactActionItem = {
  id: string;
  label: string;
  description?: string;
  href?: string;
  icon?: ReactNode;
  panel?: ReactNode;
  tone?: CompactActionTone;
};

type CompactActionTrayProps = {
  actions: CompactActionItem[];
  className?: string;
  closeHref?: string;
  defaultActionId?: string;
  eyebrow?: string;
  summary?: ReactNode;
  title?: string;
};

const buttonToneClassNames: Record<CompactActionTone, string> = {
  default: "",
  primary: "compact-action-button-primary",
  warning: "compact-action-button-warning",
  danger: "compact-action-button-danger",
  financial: "compact-action-button-financial",
};

export function CompactActionTray({
  actions,
  className,
  closeHref,
  defaultActionId,
  eyebrow,
  summary,
  title = "Actions",
}: CompactActionTrayProps) {
  const baseId = useId();
  const [activeId, setActiveId] = useState<string | null>(defaultActionId ?? null);
  const activeAction = useMemo(
    () => actions.find((action) => action.id === activeId) ?? null,
    [actions, activeId],
  );

  if (!actions.length) {
    return null;
  }

  return (
    <section
      className={cn(
        "compact-action-tray min-w-0 rounded-md border border-[var(--line)] bg-white p-3",
        className,
      )}
    >
      <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(10rem,0.45fr)_minmax(0,1.55fr)] md:items-center">
        <div className="min-w-0">
          {eyebrow ? <p className="text-xs text-[var(--muted)]">{eyebrow}</p> : null}
          <h2 className="font-display text-base font-semibold text-[var(--ink)]">{title}</h2>
          {summary ? <div className="metadata-line mt-1">{summary}</div> : null}
        </div>
        <div className="flex min-w-0 flex-wrap gap-2 md:justify-end" role="list">
          {actions.map((action) => {
            const isActive = action.id === activeId;
            const panelId = `${baseId}-${action.id}`;
            const className = cn(
              "compact-action-button inline-flex min-h-10 max-w-full items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-sm font-semibold transition-colors",
              buttonToneClassNames[action.tone ?? "default"],
              isActive && "is-active shadow-sm ring-2 ring-[var(--focus)] ring-offset-1 ring-offset-[var(--page-soft)]",
            );

            const href = action.href ?? (isActive ? closeHref : undefined);

            if (href) {
              return (
                <Link
                  aria-label={action.description ? `${action.label}: ${action.description}` : action.label}
                  aria-controls={action.panel ? panelId : undefined}
                  aria-expanded={action.panel ? isActive : undefined}
                  className={className}
                  href={href}
                  key={action.id}
                >
                  {action.icon}
                  <span>{action.label}</span>
                </Link>
              );
            }

            return (
              <button
                aria-label={action.description ? `${action.label}: ${action.description}` : action.label}
                aria-controls={panelId}
                aria-expanded={isActive}
                className={className}
                key={action.id}
                onClick={() => setActiveId(isActive ? null : action.id)}
                type="button"
              >
                {action.icon}
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {activeAction ? (
        <div className="compact-action-panel mt-3 min-w-0 border-t border-[var(--line)] pt-3" id={`${baseId}-${activeAction.id}`}>
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="wrap-value font-semibold text-[var(--ink)]">{activeAction.label}</p>
              {activeAction.description ? (
                <p className="wrap-value text-sm text-[var(--muted)]">{activeAction.description}</p>
              ) : null}
            </div>
            {closeHref ? (
              <Link className="table-action" href={closeHref}>
                Close
              </Link>
            ) : (
              <button className="table-action" onClick={() => setActiveId(null)} type="button">
                Close
              </button>
            )}
          </div>
          <div className="mt-4 min-w-0">{activeAction.panel}</div>
        </div>
      ) : null}
    </section>
  );
}
