import Link from "next/link";

import { signOut } from "@/auth";

export default function AccessDeniedPage() {
  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-10">
      <section className="w-full border border-[var(--line)] bg-white p-6">
        <p className="text-xs font-semibold uppercase text-[var(--muted)]">Access</p>
        <h1 className="mt-2 text-2xl font-semibold">This workspace is not available</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Your current role or active lab does not permit this page.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link className="inline-flex table-action" href="/">Return to dashboard</Link>
          <form action={signOutAction}>
            <button className="table-action" type="submit">Sign in again</button>
          </form>
        </div>
      </section>
    </main>
  );
}
