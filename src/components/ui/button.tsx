"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[var(--accent)] px-4 py-2 text-white shadow-none hover:bg-[var(--accent-strong)] focus-visible:ring-[var(--accent)]",
        secondary: "border border-[var(--line)] bg-[var(--surface-2)] px-4 py-2 text-[var(--ink)] hover:bg-[var(--surface-3)] focus-visible:ring-[var(--accent)]",
        ghost: "px-3 py-2 text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] focus-visible:ring-[var(--accent)]",
        subtle: "border border-[var(--line)] bg-white px-4 py-2 text-[var(--ink)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] focus-visible:ring-[var(--accent)]",
        warning: "border border-amber-600/40 bg-amber-50 px-4 py-2 text-amber-900 hover:bg-amber-100 focus-visible:ring-amber-600",
        danger: "border border-red-600/35 bg-red-600 px-4 py-2 text-white hover:bg-red-700 focus-visible:ring-red-600",
      },
      size: {
        default: "h-11 md:h-10",
        sm: "h-11 px-3 text-xs md:h-9",
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
