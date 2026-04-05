"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";

import { authenticateAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DemoAccount = {
  name: string;
  email: string;
  password: string;
  role: string;
};

export function LoginForm({ demoAccounts }: { demoAccounts: DemoAccount[] }) {
  const [errorMessage, action, pending] = useActionState(authenticateAction, undefined);

  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1.35fr)_400px]">
      <section className="relative overflow-hidden rounded-[36px] bg-[var(--hero)] px-8 py-10 text-[var(--hero-ink)] md:px-10 md:py-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(109,163,255,0.28),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(67,191,161,0.18),transparent_30%)]" />
        <div className="relative flex h-full flex-col justify-between gap-10">
          <div className="space-y-6">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.22em] text-white/65">Mouse Colony Manager</p>
              <h1 className="max-w-3xl font-display text-5xl font-semibold tracking-[-0.08em] text-white md:text-7xl">
                Cages first. Lineage intact. Rules visible.
              </h1>
            </div>
            <p className="max-w-2xl text-base leading-8 text-white/72 md:text-lg">
              Run mouse colony operations from one working surface with cage lookup, genotype tracking, breeding
              planning, experiment assignment, and configurable compliance alerts.
            </p>
          </div>
          <div className="grid gap-4 border-t border-white/10 pt-6 md:grid-cols-3">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.18em] text-white/55">Cage workspace</p>
              <p className="text-sm leading-7 text-white/72">
                Scan a cage, review occupancy, and capture welfare notes without leaving the room flow.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.18em] text-white/55">Animal record</p>
              <p className="text-sm leading-7 text-white/72">
                Trace each mouse across lineage, genotype, project attribution, experiment history, and outcome.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.18em] text-white/55">Rule engine</p>
              <p className="text-sm leading-7 text-white/72">
                Keep breeder age, occupancy, and genotype timing thresholds editable by admin instead of hardcoded.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="rounded-[32px] border border-[var(--line)] bg-[var(--surface)] p-8 backdrop-blur-sm shadow-[0_16px_40px_rgba(19,24,39,0.04)]">
        <form action={action} className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Demo access</p>
            <h2 className="font-display text-2xl font-semibold tracking-[-0.04em]">Open the workspace</h2>
            <p className="text-sm leading-7 text-[var(--muted)]">
              Use one of the seeded roles to inspect staff, researcher, and admin workflows.
            </p>
          </div>
          <div className="space-y-3">
            <label className="space-y-2 text-sm text-[var(--muted)]">
              Email
              <Input defaultValue={demoAccounts[0]?.email} name="email" data-testid="login-email" />
            </label>
            <label className="space-y-2 text-sm text-[var(--muted)]">
              Password
              <Input
                defaultValue={demoAccounts[0]?.password}
                name="password"
                type="password"
                data-testid="login-password"
              />
            </label>
          </div>
          {errorMessage ? <p className="text-sm text-rose-700">{errorMessage}</p> : null}
          <Button className="w-full" type="submit" data-testid="login-submit">
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            Enter workspace
          </Button>
        </form>
        <div className="mt-6 space-y-3 border-t border-[var(--line)] pt-5">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Seeded roles</p>
          <div className="space-y-3">
            {demoAccounts.map((account) => (
              <div key={account.email} className="rounded-2xl border border-[var(--line)] bg-white/55 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-[var(--ink)]">{account.name}</span>
                  <span className="text-[var(--muted)]">{account.role.replaceAll("_", " ")}</span>
                </div>
                <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                  {account.email} / {account.password}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
