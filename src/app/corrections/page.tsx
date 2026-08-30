import { AppShell } from "@/components/app/app-shell";
import { CorrectionDecisionForm, CorrectionRequestForm } from "@/components/app/correction-command-form";
import { PageHeader } from "@/components/app/page-header";
import { WorksheetShell } from "@/components/app/worksheet-shell";
import { CORRECTION_DOMAIN_LABELS } from "@/lib/correction-state-machine";
import { getCorrectionWorkspace } from "@/lib/correction-read";
import { requireUser } from "@/lib/session";
import { decideCorrectionRequestAction, submitCorrectionRequestAction } from "./actions";

const json = (value: unknown) => JSON.stringify(value, null, 2);
const notices = {
  "request-blocked": "The request was recorded but is blocked from approval because it requires physical or structural reconciliation policy.",
  "request-submitted": "Correction request submitted for independent review.",
  "supersession-applied": "Metadata supersession applied without changing the source record.",
  "request-rejected": "Correction request rejected.",
} as const;

export default async function CorrectionsPage({ searchParams }: { searchParams: Promise<{ notice?: string | string[] }> }) {
  const user = await requireUser({ capability: "corrections:read" });
  const params = await searchParams;
  const noticeCode = typeof params.notice === "string" && params.notice in notices ? params.notice as keyof typeof notices : null;
  const view = await getCorrectionWorkspace(user);
  const canRequest = user.capabilities.includes("corrections:request");
  const steward = view.access === "data_steward";
  return (
    <AppShell currentPath="/corrections" role={user.role} userName={user.name ?? user.email}>
      <div className="space-y-6" data-correction-access={view.access} data-testid="correction-workspace">
        <PageHeader eyebrow="Data integrity" title="Controlled corrections" description="Preserve the original evidence and add an independently reviewed metadata supersession. This workflow does not reverse a physical action." />
        {noticeCode ? <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950" data-testid="correction-notice" role="status">{notices[noticeCode]}</p> : null}
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" data-testid="correction-policy-marker"><strong>{view.policyMarker}</strong>: structural birth/weaning, euthanasia/status, physical movement, and custody changes fail closed until institutional reconciliation policy exists. A blocked request is never an applied correction.</div>
        {canRequest ? <section className="space-y-3"><h2 className="text-xl font-semibold">Request a correction</h2><CorrectionRequestForm action={submitCorrectionRequestAction} labs={view.labs} targetOptions={view.targetOptions} /></section> : null}
        <WorksheetShell>
          <div className="space-y-4">
            <div><p className="section-kicker">{steward ? "Unit-wide privacy-minimized review" : "Your submitted requests"}</p><h2 className="text-xl font-semibold">Correction history</h2></div>
            {view.requests.length === 0 ? <p className="text-sm text-slate-600">No correction requests are available.</p> : null}
            {view.requests.map((request) => {
              const open = request.status === "pending" || request.status === "blocked";
              return <article className="space-y-3 rounded-lg border border-slate-200 p-4" data-correction-status={request.status} data-testid="correction-card" key={request.id}>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{request.lab.code} · {CORRECTION_DOMAIN_LABELS[request.domain]}</p><h3 className="font-semibold">Target {request.targetEntityId}</h3><p className="text-sm text-slate-700">{request.reason}</p></div><div className="text-right text-sm"><p className="font-semibold">{request.status}</p><p className="text-xs text-slate-500">Version {request.version}</p></div></div>
                {request.blockCode ? <div className="rounded bg-red-50 p-3 text-sm text-red-900" data-testid="correction-block-code"><strong>Cannot be applied:</strong> <code>{request.blockCode}</code>. This remains a recorded request, not a successful correction.</div> : null}
                <details className="text-sm"><summary className="cursor-pointer font-medium">Compare original and proposed values</summary><div className="mt-2 grid gap-3 lg:grid-cols-2"><pre className="overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{json(request.originalSnapshot)}</pre><pre className="overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{json(request.proposedCorrection)}</pre></div></details>
                {request.supersession ? <div className="rounded bg-emerald-50 p-3 text-sm text-emerald-950" data-testid="correction-effective-projection"><strong>Canonical effective corrected projection</strong><pre className="mt-2 overflow-x-auto text-xs">{json(request.supersession.effectiveProjection)}</pre></div> : null}
                {request.reconciliation ? <p className="text-xs text-slate-600" data-testid="correction-reconciliation">Reconciled without source-row or physical-state mutation. Downstream records enumerated: {Array.isArray(request.reconciliation.downstreamRecords) ? request.reconciliation.downstreamRecords.length : 0}.</p> : null}
                {steward && open ? <CorrectionDecisionForm action={decideCorrectionRequestAction} correctionId={request.id} expectedVersion={request.version} allowApprove={request.status === "pending" && request.requestedBy.id !== user.id} /> : null}
              </article>;
            })}
          </div>
        </WorksheetShell>
      </div>
    </AppShell>
  );
}
