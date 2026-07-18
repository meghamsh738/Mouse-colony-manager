import * as React from "react";

import { cn } from "@/lib/utils";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-11 w-full min-w-0 rounded-md border border-[var(--line)] bg-white px-3 text-base text-[var(--ink)] outline-none transition placeholder:text-[color-mix(in_srgb,var(--muted)_62%,white)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)] md:h-10 md:text-sm",
      className,
    )}
    {...props}
  />
));

Input.displayName = "Input";
