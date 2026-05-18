import { cn } from "@/lib/utils";

type SurfaceProps = React.HTMLAttributes<HTMLElement> & {
  as?: "section" | "article" | "div";
};

export function Surface({ as = "section", className, ...props }: SurfaceProps) {
  const Component = as;

  return (
    <Component
      className={cn(
        "min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_8px_24px_rgba(34,31,22,0.05)] ring-1 ring-white/45 backdrop-blur md:p-5",
        className,
      )}
      {...props}
    />
  );
}
