import * as React from "react";

import { cn } from "@/lib/utils";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] shadow-none outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm",
      className,
    )}
    {...props}
  />
));

Input.displayName = "Input";
