import { cn } from "@/lib/utils";

type SurfaceProps = React.HTMLAttributes<HTMLElement> & {
  as?: "section" | "article" | "div";
};

export function Surface({ as = "section", className, ...props }: SurfaceProps) {
  const Component = as;

  return (
    <Component
      className={cn(
        "min-w-0 rounded-[28px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_18px_50px_rgba(34,31,22,0.08)] ring-1 ring-white/45 backdrop-blur md:p-6",
        className,
      )}
      {...props}
    />
  );
}
