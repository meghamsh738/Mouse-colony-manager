import type React from "react";

import { cn } from "@/lib/utils";

type ContextBandItem = {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "warning" | "danger" | "success";
};

type ContextBandProps = {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  items: ContextBandItem[];
  actions?: React.ReactNode;
  className?: string;
  sticky?: boolean;
};

const itemToneClassNames = {
  default: "border-[var(--line)] bg-white/58 text-[var(--muted-strong)]",
  warning: "border-amber-300 bg-amber-50/88 text-amber-900",
  danger: "border-red-300 bg-red-50/90 text-red-900",
  success: "border-emerald-300 bg-emerald-50/88 text-emerald-900",
};

export function ContextBand({ title, subtitle, items, actions, className, sticky = false }: ContextBandProps) {
  return (
    <section
      className={cn(
        "context-band",
        sticky && "sticky top-[4.25rem] z-20",
        className,
      )}
    >
      <div className="min-w-0">
        {title ? <p className="wrap-value font-mono text-sm font-semibold text-[var(--ink)]">{title}</p> : null}
        {subtitle ? <p className="wrap-value mt-1 text-sm text-[var(--muted)]">{subtitle}</p> : null}
        <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
          {items.map((item) => (
            <span
              className={cn(
                "inline-flex min-h-7 max-w-full items-center gap-1 rounded border px-2.5 text-xs font-medium",
                itemToneClassNames[item.tone ?? "default"],
              )}
              key={item.label}
            >
              <span className="text-[var(--muted)]">{item.label}</span>
              <span className="wrap-value">{item.value}</span>
            </span>
          ))}
        </div>
      </div>
      {actions ? <div className="command-bar md:justify-end">{actions}</div> : null}
    </section>
  );
}

export function CommandBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("command-bar", className)}>{children}</div>;
}

type InlineSectionProps = {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "warning" | "danger" | "financial";
};

const sectionToneClassNames = {
  default: "border-[var(--line)]",
  warning: "border-amber-300",
  danger: "border-red-300",
  financial: "border-amber-300",
};

export function InlineSection({ title, meta, actions, children, className, tone = "default" }: InlineSectionProps) {
  return (
    <section className={cn("inline-section", sectionToneClassNames[tone], className)}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="wrap-value font-display text-lg font-semibold tracking-[-0.03em] text-[var(--ink)]">{title}</h2>
          {meta ? <div className="metadata-line mt-1">{meta}</div> : null}
        </div>
        {actions ? <div className="action-row shrink-0">{actions}</div> : null}
      </div>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}
