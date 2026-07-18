import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LoginForm } from "@/components/app/login-form";
import { getSeededDevAccounts } from "@/lib/dev-accounts";

export default async function LoginPage() {
  const session = await auth();
  const showDevAccounts =
    process.env.NODE_ENV !== "production" && process.env.EMPTY_COLONY_BOOTSTRAP !== "true";

  if (session?.user) {
    redirect("/");
  }

  return (
    <main className="login-screen min-h-screen px-5 py-8 md:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-lg items-center justify-center">
        <LoginForm
          seededAccounts={showDevAccounts ? getSeededDevAccounts() : []}
          showDevAccounts={showDevAccounts}
        />
      </div>
    </main>
  );
}
