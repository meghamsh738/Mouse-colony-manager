import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LoginForm } from "@/components/app/login-form";
import { getSeededDevAccounts } from "@/lib/dev-accounts";

export default async function LoginPage() {
  const session = await auth();

  if (session?.user) {
    redirect("/");
  }

  return (
    <main className="min-h-screen bg-[var(--page)] px-5 py-5 md:px-8 md:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-[1480px] items-stretch">
        <LoginForm seededAccounts={getSeededDevAccounts()} />
      </div>
    </main>
  );
}
