import Link from "next/link";

import { activateAccountAction } from "@/app/activate/actions";
import { IdentityActivationForm } from "@/components/app/identity-activation-form";
import { getInvitationPreview } from "@/lib/identity-governance";

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const rawToken = (await searchParams).token;
  const token = typeof rawToken === "string" ? rawToken : "";
  const invitation = await getInvitationPreview(token);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-10 sm:px-6">
      <section className="w-full rounded-2xl border border-[var(--line)] bg-white p-6 shadow-sm sm:p-8" aria-labelledby="activation-title">
        <h1 className="text-2xl font-semibold text-[var(--ink)]" id="activation-title">Activate your account</h1>
        {invitation ? (
          <>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Complete your account for <strong className="text-[var(--ink)]">{invitation.email}</strong>
              {invitation.lab ? ` in ${invitation.lab.name}` : ""}.
            </p>
            <IdentityActivationForm
              action={activateAccountAction}
              defaultName={invitation.name ?? ""}
              token={token}
            />
          </>
        ) : (
          <div className="mt-5 space-y-4">
            <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950" role="alert">
              This activation link is invalid, expired, or has already been used. Ask a Facility Admin for a new invitation.
            </p>
            <Link className="text-sm font-semibold text-[var(--accent)] hover:underline" href="/login">Return to sign in</Link>
          </div>
        )}
      </section>
    </main>
  );
}
