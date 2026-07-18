"use client";

import { useActionState } from "react";
import { ChevronDown, LoaderCircle, LockKeyhole } from "lucide-react";

import { authenticateAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SeededAccount = {
  name: string;
  email: string;
  password: string;
  role: string;
};

export function LoginForm({
  seededAccounts,
  showDevAccounts,
}: {
  seededAccounts: SeededAccount[];
  showDevAccounts: boolean;
}) {
  const [errorMessage, action, pending] = useActionState(authenticateAction, undefined);

  return (
    <section className="login-panel">
      <div className="login-brand">
        <span className="login-brand-mark">MM</span>
        <div>
          <p className="text-sm font-semibold text-white">Mouse Colony</p>
          <p className="text-xs text-white/60">Manager</p>
        </div>
      </div>

      <div className="login-panel-body">
        <div className="mb-6">
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
            <LockKeyhole className="h-4 w-4" aria-hidden="true" />
          </div>
          <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Sign in</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Access colony records and daily work.</p>
        </div>

        <form action={action} className="space-y-4">
          <label className="block text-sm font-medium text-[var(--muted-strong)]">
            <span className="mb-1.5 block">Email</span>
            <Input
              autoComplete="email"
              defaultValue={showDevAccounts ? seededAccounts[0]?.email : ""}
              name="email"
              data-testid="login-email"
            />
          </label>
          <label className="block text-sm font-medium text-[var(--muted-strong)]">
            <span className="mb-1.5 block">Password</span>
            <Input
              autoComplete="current-password"
              defaultValue={showDevAccounts ? seededAccounts[0]?.password : ""}
              name="password"
              type="password"
              data-testid="login-password"
            />
          </label>
          {errorMessage ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <Button className="w-full" type="submit" data-testid="login-submit">
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            Sign in
          </Button>
        </form>

        {showDevAccounts ? (
          <details className="login-test-accounts group mt-6">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-sm font-medium text-[var(--muted)] [&::-webkit-details-marker]:hidden">
              Local test accounts
              <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="border-t border-[var(--line)] pt-2">
              {seededAccounts.map((account) => (
                <div key={account.email} className="login-account-row">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-[var(--ink)]">{account.name}</span>
                    <span className="shrink-0 text-xs capitalize text-[var(--muted)]">
                      {account.role.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 wrap-value font-mono text-xs text-[var(--muted)]">
                    {account.email} / {account.password}
                  </p>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
