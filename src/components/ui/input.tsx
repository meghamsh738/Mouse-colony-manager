import * as React from "react";

import { cn } from "@/lib/utils";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-11 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-white/70 px-4 text-base text-[var(--ink)] shadow-[0_1px_0_rgba(255,255,255,0.75)_inset] outline-none transition placeholder:text-[color-mix(in_srgb,var(--muted)_65%,white)] focus:border-[var(--accent)] focus:bg-white focus:ring-2 focus:ring-[var(--focus)] md:text-sm",
      className,
    )}
    {...props}
  />
));

Input.displayName = "Input";
