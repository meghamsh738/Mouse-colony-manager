import { cn } from "@/lib/utils";

type OperationalSectionProps = {
  id?: string;
  title: string;
  eyebrow?: string;
  defaultOpen?: boolean;
  tone?: "default" | "warning" | "danger" | "financial";
  closedLabel?: string;
  openLabel?: string;
  className?: string;
  children: React.ReactNode;
};

const toneClassNames = {
  default: "border-[var(--line)] bg-transparent",
  warning: "border-amber-300 bg-amber-50/62",
  danger: "border-red-300 bg-red-50/76",
  financial: "border-amber-300 bg-amber-50/62",
};

export function OperationalSection({
  id,
  title,
  eyebrow,
  defaultOpen = false,
  tone = "default",
  closedLabel = "Open",
  openLabel = "Collapse",
  className,
  children,
}: OperationalSectionProps) {
  const isEmphasized = tone !== "default";

  return (
    <details
      id={id}
      className={cn(
        "operational-section group min-w-0",
        isEmphasized
          ? "rounded-md border p-3"
          : "rounded-lg border border-x-0 bg-transparent p-0 shadow-none",
        toneClassNames[tone],
        className,
      )}
      open={defaultOpen}
    >
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-2.5 [&::-webkit-details-marker]:hidden",
          isEmphasized ? "px-0" : "px-1",
        )}
      >
        <span className="min-w-0">
          {eyebrow ? (
            <span className="block text-xs text-[var(--muted-strong)]">{eyebrow}</span>
          ) : null}
          <span className="wrap-value block font-display text-base font-semibold text-[var(--ink)]">
            {title}
          </span>
        </span>
        <span className="shrink-0 rounded border border-[var(--line)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--muted)] group-open:hidden">
          {closedLabel}
        </span>
        <span className="hidden shrink-0 rounded border border-[var(--line)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--muted)] group-open:inline">
          {openLabel}
        </span>
      </summary>
      <div className={cn("border-t border-[var(--line)] py-3 md:py-4", isEmphasized ? "pb-0" : "")}>
        {children}
      </div>
    </details>
  );
}
