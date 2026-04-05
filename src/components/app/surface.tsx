import { cn } from "@/lib/utils";

type SurfaceProps = React.HTMLAttributes<HTMLElement> & {
  as?: "section" | "article" | "div";
};

export function Surface({ as = "section", className, ...props }: SurfaceProps) {
  const Component = as;

  return (
    <Component
      className={cn(
        "rounded-[28px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_12px_28px_rgba(18,24,38,0.04)] md:p-6",
        className,
      )}
      {...props}
    />
  );
}
