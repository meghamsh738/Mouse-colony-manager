"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[var(--accent)] px-4 py-2 text-[var(--hero-ink)] shadow-[0_10px_24px_rgba(0,63,50,0.18)] hover:bg-[var(--accent-strong)] focus-visible:ring-[var(--accent)]",
        secondary: "bg-[var(--surface-2)] px-4 py-2 text-[var(--ink)] shadow-[0_1px_0_rgba(255,255,255,0.8)_inset] hover:bg-[var(--surface-3)] focus-visible:ring-[var(--accent)]",
        ghost: "px-3 py-2 text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] focus-visible:ring-[var(--accent)]",
        subtle: "border border-[var(--line)] bg-white/35 px-4 py-2 text-[var(--ink)] shadow-[0_1px_0_rgba(255,255,255,0.85)_inset] hover:border-[var(--line-strong)] hover:bg-white/70 focus-visible:ring-[var(--accent)]",
      },
      size: {
        default: "h-10",
        sm: "h-9 px-3 text-xs",
        lg: "h-11 px-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);

Button.displayName = "Button";
