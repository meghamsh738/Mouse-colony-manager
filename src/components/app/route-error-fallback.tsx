"use client";

import Link from "next/link";
import { BellRing, Boxes, QrCode, RefreshCcw, Table2 } from "lucide-react";

type RouteErrorFallbackProps = {
  title: string;
  message: string;
  reset?: () => void;
};

const staffLinks = [
  { href: "/scan", label: "Scan", icon: QrCode },
  { href: "/cages", label: "Cages", icon: Boxes },
  { href: "/animals", label: "Animals", icon: Table2 },
  { href: "/notifications", label: "Alerts", icon: BellRing },
];

export function RouteErrorFallback({ message, reset, title }: RouteErrorFallbackProps) {
  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--ink)]">
      <section className="mx-auto max-w-2xl rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_8px_24px_rgba(34,31,22,0.05)] md:p-6">
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Mouse Colony Manager</p>
        <h1 className="mt-3 font-display text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{message}</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-4">
          {staffLinks.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-white/70 px-3 text-sm font-medium transition hover:border-[var(--line-strong)]"
                href={item.href}
                key={item.href}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </div>
        {reset ? (
          <button
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--hero)] px-4 text-sm font-medium text-[var(--hero-ink)]"
            onClick={reset}
            type="button"
          >
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        ) : null}
      </section>
    </main>
  );
}
