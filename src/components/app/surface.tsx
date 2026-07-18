import { cn } from "@/lib/utils";

type SurfaceProps = React.HTMLAttributes<HTMLElement> & {
  as?: "section" | "article" | "div";
  variant?: "default" | "summary" | "action" | "warning" | "danger" | "financial";
};

const variantClassNames = {
  default: "border-[var(--line)] bg-[var(--surface)] shadow-none",
  summary: "border-[var(--line)] bg-[var(--surface-subtle)] shadow-none",
  action: "border-[var(--line-strong)] bg-[var(--surface)] shadow-none",
  warning: "border-amber-300 bg-amber-50/72 shadow-none",
  danger: "border-red-300 bg-red-50/74 shadow-none",
  financial: "border-blue-200 bg-blue-50/55 shadow-none",
};

export function Surface({ as = "section", className, variant = "default", ...props }: SurfaceProps) {
  const Component = as;

  return (
    <Component
      className={cn(
        "min-w-0 rounded-md border p-3 md:p-4",
        variantClassNames[variant],
        className,
      )}
      {...props}
    />
  );
}
