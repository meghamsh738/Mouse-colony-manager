import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { WelfareCommandForm, WelfareOpenCaseForm } from "@/components/app/welfare-command-form";
import { WorksheetShell } from "@/components/app/worksheet-shell";
import { requireUser } from "@/lib/session";
import { getWelfareWorkspace } from "@/lib/welfare-read";
import {
  acknowledgeWelfareEscalationAction,
  approveWelfareTreatmentAction,
  cancelWelfareCaseAction,
  closeWelfareCaseAction,
  openWelfareCaseAction,
  openWelfareEscalationAction,
  proposeWelfareTreatmentAction,
  recordWelfareAdministrationAction,
  recordWelfareObservationAction,
  resolveWelfareEscalationAction,
  stopWelfareTreatmentAction,
  triageWelfareCaseAction,
} from "./actions";

const now = () => new Date().toISOString().slice(0, 16);
const field = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

export default async function WelfarePage() {
  const user = await requireUser({ capability: "welfare:read" });
  const view = await getWelfareWorkspace(user);
  const veterinarian = view.access === "designated_veterinarian";
  const canManage = user.capabilities.includes("welfare:manage");
  const canClose = user.capabilities.includes("welfare:close") && veterinarian;
  const subjects = [
    ...view.animalOptions.map((animal) => ({ id: animal.id, type: "animal" as const, version: animal.version, label: `Animal ${animal.facilityAnimalId} · ${animal.owningLab.code}` })),
    ...view.cageOptions.map((cage) => ({ id: cage.id, type: "cage" as const, version: cage.version, label: `Cage ${cage.barcode} · ${cage.lab.code}` })),
  ];

  return (
    <AppShell currentPath="/welfare" role={user.role} userName={user.name ?? user.email}>
      <div className="space-y-6" data-testid="welfare-workspace" data-welfare-access={view.access}>
        <PageHeader eyebrow="Veterinary and welfare" title="Welfare cases" description="Coordinate attention, observation, treatment orders, escalation, and closure. This synthetic policy is operational support, not an institutionally validated clinical record." />
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" data-testid="welfare-policy-marker">
          Policy: <strong>{view.policyMarker}</strong>. Terminology, severity, formulary, response targets, retention, and emergency paging still require institutional validation. Notifications attract attention only and never change case state.
        </div>

        {canManage ? (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Open a case</h2>
            <WelfareOpenCaseForm action={openWelfareCaseAction} subjects={subjects} />
          </section>
        ) : null}

        <WorksheetShell>
          <div className="space-y-4">
            <div><p className="section-kicker">Current unit workload</p><h2 className="text-xl font-semibold">Cases</h2></div>
            {view.cases.length === 0 ? <p className="text-sm text-slate-600">No welfare cases are available for your current duty.</p> : null}
            {view.cases.map((welfareCase) => {
              const terminal = welfareCase.status === "closed" || welfareCase.status === "cancelled";
              return (
                <article className="space-y-4 rounded-lg border border-slate-200 p-4" data-testid="welfare-case-card" key={welfareCase.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{welfareCase.lab.code} · {welfareCase.subjectType}</p><h3 className="font-semibold">{welfareCase.animal?.facilityAnimalId ?? welfareCase.cage?.barcode ?? "Subject"}</h3><p className="text-sm text-slate-700">{welfareCase.operationalSummary}</p></div>
                    <div className="text-right text-sm"><p className="font-medium">{welfareCase.status.replaceAll("_", " ")}</p><p className={welfareCase.severity === "critical" ? "text-red-700" : "text-slate-600"}>{welfareCase.severity}</p><p className="text-xs text-slate-500">Version {welfareCase.version}</p></div>
                  </div>
                  {veterinarian && "privateClinicalSummary" in welfareCase ? <div className="rounded bg-slate-50 p-3 text-sm" data-testid="welfare-private-clinical"><strong>Private clinical context:</strong> {welfareCase.privateClinicalSummary}</div> : null}
                  {!terminal && canManage ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {welfareCase.status === "open" ? <WelfareCommandForm action={triageWelfareCaseAction} label="Triage case"><CaseIdentity id={welfareCase.id} version={welfareCase.version} /><input name="triagedAt" type="hidden" value={now()} /></WelfareCommandForm> : null}
                      <WelfareCommandForm action={recordWelfareObservationAction} label="Record observation"><CaseIdentity id={welfareCase.id} version={welfareCase.version} /><input name="observedAt" type="hidden" value={now()} /><select className={field} name="severity" defaultValue={welfareCase.severity}><option value="info">Information</option><option value="warning">Concern</option><option value="critical">Critical</option></select><select className={field} name="operationalCode" defaultValue="condition_change"><option value="routine_review">Routine review</option><option value="condition_change">Condition change</option><option value="post_procedure">Post-procedure</option><option value="environmental_concern">Environmental concern</option><option value="other">Other</option></select><textarea className={field} name="privateNote" placeholder="Private observation" required /></WelfareCommandForm>
                      <WelfareCommandForm action={openWelfareEscalationAction} label="Escalate"><CaseIdentity id={welfareCase.id} version={welfareCase.version} /><input name="openedAt" type="hidden" value={now()} /><select className={field} name="severity" defaultValue="critical"><option value="warning">Urgent</option><option value="critical">Critical</option></select><select className={field} name="operationalCode"><option value="urgent_review">Urgent review</option><option value="condition_worsened">Condition worsened</option><option value="treatment_concern">Treatment concern</option><option value="humane_endpoint_review">Humane endpoint review</option><option value="other">Other</option></select><textarea className={field} name="privateReason" placeholder="Private escalation reason" required /></WelfareCommandForm>
                      {veterinarian && welfareCase.status !== "open" ? <WelfareCommandForm action={proposeWelfareTreatmentAction} label="Propose treatment"><CaseIdentity id={welfareCase.id} version={welfareCase.version} /><input name="proposedAt" type="hidden" value={now()} /><input className={field} name="medication" placeholder="Medication" required /><input className={field} name="dose" placeholder="Dose" required /><input className={field} name="route" placeholder="Route" required /><input className={field} name="frequency" placeholder="Frequency" required /><textarea className={field} name="instructions" placeholder="Private instructions" required /></WelfareCommandForm> : null}
                      {canClose ? <WelfareCommandForm action={closeWelfareCaseAction} label="Close case" tone="secondary"><CaseIdentity id={welfareCase.id} version={welfareCase.version} /><input name="closedAt" type="hidden" value={now()} /><textarea className={field} name="closureReason" placeholder="Private closure reason" required /></WelfareCommandForm> : null}
                      <WelfareCommandForm action={cancelWelfareCaseAction} label="Cancel duplicate / non-case" tone="danger"><CaseIdentity id={welfareCase.id} version={welfareCase.version} /><input name="cancelledAt" type="hidden" value={now()} /><select className={field} name="cancellationCode"><option value="duplicate">Duplicate</option><option value="not_a_case">Not a case</option></select><textarea className={field} name="cancellationReason" placeholder="Private cancellation reason" required /></WelfareCommandForm>
                    </div>
                  ) : null}
                  {"escalations" in welfareCase ? welfareCase.escalations.map((escalation) => <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm" key={escalation.id}><p className="font-medium">{escalation.severity} escalation · {escalation.status}</p><p>{escalation.operationalCode.replaceAll("_", " ")}</p>{!terminal && escalation.status === "open" ? <WelfareCommandForm action={acknowledgeWelfareEscalationAction} label="Acknowledge" tone="secondary"><CaseIdentity id={welfareCase.id} version={welfareCase.version} /><input name="escalationId" type="hidden" value={escalation.id} /><input name="expectedEscalationVersion" type="hidden" value={escalation.version} /><input name="acknowledgedAt" type="hidden" value={now()} /></WelfareCommandForm> : null}{veterinarian && !terminal && escalation.status === "acknowledged" ? <WelfareCommandForm action={resolveWelfareEscalationAction} label="Resolve escalation"><CaseIdentity id={welfareCase.id} version={welfareCase.version} /><input name="escalationId" type="hidden" value={escalation.id} /><input name="expectedEscalationVersion" type="hidden" value={escalation.version} /><input name="resolvedAt" type="hidden" value={now()} /><textarea className={field} name="resolutionNote" placeholder="Private resolution note" required /></WelfareCommandForm> : null}</div>) : null}
                  {veterinarian && "treatmentOrders" in welfareCase ? welfareCase.treatmentOrders.map((order) => <div className="space-y-2 rounded border border-sky-200 bg-sky-50 p-3 text-sm" data-testid="welfare-treatment-order" key={order.id}><p className="font-medium">{order.medication} · {order.dose} · {order.status}</p><p>{order.route}; {order.frequency}</p>{!terminal && order.status === "proposed" ? <WelfareCommandForm action={approveWelfareTreatmentAction} label="Approve order"><CaseIdentity id={welfareCase.id} version={welfareCase.version} /><OrderIdentity id={order.id} version={order.version} /><input name="approvedAt" type="hidden" value={now()} /></WelfareCommandForm> : null}{!terminal && ["approved", "active"].includes(order.status) ? <><WelfareCommandForm action={recordWelfareAdministrationAction} label="Record administration"><CaseIdentity id={welfareCase.id} version={welfareCase.version} /><OrderIdentity id={order.id} version={order.version} /><input name="administeredAt" type="hidden" value={now()} /><select className={field} name="outcome"><option value="administered">Administered</option><option value="not_administered">Not administered</option><option value="error">Error</option></select><input className={field} name="actualDose" placeholder="Actual dose" /><textarea className={field} name="privateNote" placeholder="Private note" /></WelfareCommandForm><WelfareCommandForm action={stopWelfareTreatmentAction} label="Stop order" tone="danger"><CaseIdentity id={welfareCase.id} version={welfareCase.version} /><OrderIdentity id={order.id} version={order.version} /><input name="stoppedAt" type="hidden" value={now()} /><textarea className={field} name="reason" placeholder="Private stop reason" required /></WelfareCommandForm></> : null}</div>) : null}
                </article>
              );
            })}
          </div>
        </WorksheetShell>
      </div>
    </AppShell>
  );
}

function CaseIdentity({ id, version }: { id: string; version: number }) {
  return <><input name="caseId" type="hidden" value={id} /><input name="expectedVersion" type="hidden" value={version} /></>;
}

function OrderIdentity({ id, version }: { id: string; version: number }) {
  return <><input name="orderId" type="hidden" value={id} /><input name="expectedOrderVersion" type="hidden" value={version} /></>;
}
