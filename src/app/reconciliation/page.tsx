import { randomUUID } from "node:crypto";

import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { ReconciliationWorkbench } from "@/components/app/reconciliation-workbench";
import { getReconciliationWorkspace } from "@/lib/reconciliation-read";
import { requireUser } from "@/lib/session";

const notices = {
  "evidence-saved": "Operational evidence was saved and the current state was refreshed.",
} as const;

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ notice?: string | string[] }> }) {
  const user = await requireUser({ capability: "reconciliation:read" });
  const params = await searchParams;
  const noticeCode = typeof params.notice === "string" && params.notice in notices ? params.notice as keyof typeof notices : null;
  const workspace = await getReconciliationWorkspace(user);
  return (
    <AppShell currentPath="/reconciliation" role={user.role} userName={user.name ?? user.email}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Operational evidence"
          title="Intake and census reconciliation"
          description="Compare expected shipments, physical observations, quarantine evidence, census findings, and transfer custody without silently rewriting colony records."
        />
        {noticeCode ? <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950" data-testid="reconciliation-notice" role="status">{notices[noticeCode]}</p> : null}
        <ReconciliationWorkbench
          nonce={`m16-${randomUUID()}`}
          today={new Date().toISOString().slice(0, 10)}
          workspace={workspace}
        />
      </div>
    </AppShell>
  );
}
