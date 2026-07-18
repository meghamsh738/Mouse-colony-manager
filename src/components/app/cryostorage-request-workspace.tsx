"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import {
  cancelCryostorageRequestAction,
  executeCryostorageRequestAction,
  submitCryostorageRequestAction,
} from "@/app/cryostorage/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { WorkflowImpact, WorkflowSteps } from "@/components/app/workflow-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";
import type { CryostorageInventoryItem, CryostorageRequestItem } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type Option = { id: string; label: string };
type ProjectOption = Option & { labId: string };

function commandIdentity(prefix: string) {
  const nonce = crypto.randomUUID();
  return { idempotencyKey: `${prefix}:${nonce}`, requestId: `${prefix}:request:${nonce}` };
}

function CommandIdentityFields({ identity }: { identity: ReturnType<typeof commandIdentity> }) {
  return (
    <>
      <input name="idempotencyKey" type="hidden" value={identity.idempotencyKey} />
      <input name="requestId" type="hidden" value={identity.requestId} />
    </>
  );
}

function requestStatusVariant(status: CryostorageRequestItem["status"]) {
  if (status === "completed") return "success";
  if (status === "submitted") return "info";
  if (status === "rejected") return "danger";
  return "neutral";
}

function requestLabel(request: CryostorageRequestItem) {
  return request.sampleLabel ?? request.targetRecordLabel ?? "Cryostorage request";
}

export function CryostorageRequestForm({
  defaultLabId,
  defaultRequestedFor,
  labOptions,
  projectOptions,
  records,
  strainOptions,
}: {
  defaultLabId: string;
  defaultRequestedFor: string;
  labOptions: Option[];
  projectOptions: ProjectOption[];
  records: CryostorageInventoryItem[];
  strainOptions: Option[];
}) {
  const [state, action, pending] = useActionState(submitCryostorageRequestAction, initialFormActionState);
  const [identity] = useState(() => commandIdentity("cryostorage-submit"));
  const [requestType, setRequestType] = useState<"store" | "recover" | "discard">("store");
  const [labId, setLabId] = useState(defaultLabId || labOptions[0]?.id || "");
  const handleSubmit = useSubmitGuard(pending);
  const eligibleRecords = useMemo(() => records.filter((record) => {
    if (record.labId !== labId) return false;
    if (requestType === "recover") return ["stored", "reserved"].includes(record.status);
    if (requestType === "discard") return ["stored", "reserved", "recovered"].includes(record.status);
    return false;
  }), [labId, records, requestType]);
  const visibleProjects = projectOptions.filter((project) => project.labId === labId);

  return (
    <form action={action} className="grid gap-4" data-testid="cryostorage-request-form" onSubmit={handleSubmit}>
      <CommandIdentityFields identity={identity} />
      <div className="worksheet-filter-grid">
        <label>
          <span className="metadata-label">Lab</span>
          <select className="worksheet-input" name="labId" onChange={(event) => setLabId(event.target.value)} value={labId}>
            {labOptions.map((lab) => <option key={lab.id} value={lab.id}>{lab.label}</option>)}
          </select>
        </label>
        <label>
          <span className="metadata-label">Request</span>
          <select
            className="worksheet-input"
            name="requestType"
            onChange={(event) => setRequestType(event.target.value as typeof requestType)}
            value={requestType}
          >
            <option value="store">Store material</option>
            <option value="recover">Recover material</option>
            <option value="discard">Discard material</option>
          </select>
        </label>
        <label>
          <span className="metadata-label">Requested date</span>
          <Input defaultValue={defaultRequestedFor} name="requestedFor" type="date" />
        </label>
      </div>

      {requestType === "store" ? (
        <div className="worksheet-filter-grid">
          <label>
            <span className="metadata-label">Label</span>
            <Input name="sampleLabel" placeholder="CRYO-0001" required />
          </label>
          <label>
            <span className="metadata-label">Material</span>
            <Input name="materialType" placeholder="Frozen sperm" required />
          </label>
          <label>
            <span className="metadata-label">Strain</span>
            <select className="worksheet-input" name="strainId" required>
              <option value="">Choose strain</option>
              {strainOptions.map((strain) => <option key={strain.id} value={strain.id}>{strain.label}</option>)}
            </select>
          </label>
          <label>
            <span className="metadata-label">Project</span>
            <select className="worksheet-input" name="projectId">
              <option value="">No project</option>
              {visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.label}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <label className="grid gap-2 text-sm">
          <span className="metadata-label">Inventory record</span>
          <select className="worksheet-input" name="targetRecordId" required>
            <option value="">Choose material</option>
            {eligibleRecords.map((record) => (
              <option key={record.id} value={record.id}>
                {record.sampleLabel} · {record.materialType} · {record.status}
              </option>
            ))}
          </select>
          {eligibleRecords.length ? null : <span className="text-sm text-[var(--muted)]">No eligible records in this lab.</span>}
        </label>
      )}

      <div className="worksheet-filter-grid">
        <label>
          <span className="metadata-label">Preferred location</span>
          <Input name="requestedStorageLocation" placeholder="LN2 / cane / goblet" />
        </label>
        <label>
          <span className="metadata-label">Quantity</span>
          <Input name="requestedQuantityLabel" placeholder="6 straws" />
        </label>
      </div>
      <label className="grid gap-2 text-sm">
        <span className="metadata-label">Notes</span>
        <textarea className="min-h-24 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-base text-[var(--ink)] outline-none focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm" name="notes" placeholder="Handling or timing details" />
      </label>
      <FormFeedback state={state} />
      <Button className="w-full sm:w-fit" disabled={pending || !labId} type="submit">
        {pending ? "Submitting..." : "Submit request"}
      </Button>
    </form>
  );
}

function CancelRequestForm({ request }: { request: CryostorageRequestItem }) {
  const [state, action, pending] = useActionState(cancelCryostorageRequestAction, initialFormActionState);
  const [identity] = useState(() => commandIdentity(`cryostorage-cancel:${request.id}:${request.version}`));
  const handleSubmit = useSubmitGuard(pending);

  return (
    <form action={action} className="grid gap-3" onSubmit={handleSubmit}>
      <CommandIdentityFields identity={identity} />
      <input name="cryostorageRequestId" type="hidden" value={request.id} />
      <input name="labId" type="hidden" value={request.labId} />
      <input name="expectedVersion" type="hidden" value={request.version} />
      <label className="grid gap-2 text-sm">
        <span className="metadata-label">Cancellation reason</span>
        <Input minLength={3} name="reason" required />
      </label>
      <FormFeedback state={state} />
      <Button disabled={pending} type="submit" variant="subtle">{pending ? "Cancelling..." : "Cancel request"}</Button>
    </form>
  );
}

function ExecuteRequestForm({ request, today }: { request: CryostorageRequestItem; today: string }) {
  const [state, action, pending] = useActionState(executeCryostorageRequestAction, initialFormActionState);
  const [identity] = useState(() => commandIdentity(`cryostorage-execute:${request.id}:${request.version}`));
  const [decision, setDecision] = useState<"complete" | "reject">("complete");
  const [step, setStep] = useState<"details" | "review">("details");
  const [performedAt, setPerformedAt] = useState(today);
  const [resultingStatus, setResultingStatus] = useState<"recovered" | "depleted">("recovered");
  const [storageLocation, setStorageLocation] = useState(request.requestedStorageLocation ?? "");
  const [quantityLabel, setQuantityLabel] = useState(request.requestedQuantityLabel ?? "");
  const [reason, setReason] = useState("");
  const [operationNotes, setOperationNotes] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const handleSubmit = useSubmitGuard(pending);
  const label = requestLabel(request);
  const operationVerb = request.requestType === "store" ? "Store" : request.requestType === "recover" ? "Recover" : "Discard";
  const nextStatus = request.requestType === "store" ? "stored" : request.requestType === "recover" ? resultingStatus : "discarded";
  const canReview = decision === "reject"
    ? reason.trim().length >= 3
    : Boolean(performedAt) && (request.requestType !== "store" || storageLocation.trim().length > 0);

  return (
    <form action={action} className="grid gap-3" onSubmit={handleSubmit}>
      <CommandIdentityFields identity={identity} />
      <input name="cryostorageRequestId" type="hidden" value={request.id} />
      <input name="labId" type="hidden" value={request.labId} />
      <input name="expectedVersion" type="hidden" value={request.version} />
      <input name="action" type="hidden" value={decision} />
      <input name="performedAt" type="hidden" value={performedAt} />
      <input name="resultingStatus" type="hidden" value={resultingStatus} />
      <input name="storageLocation" type="hidden" value={storageLocation} />
      <input name="quantityLabel" type="hidden" value={quantityLabel} />
      <input name="reason" type="hidden" value={reason} />
      <input name="operationNotes" type="hidden" value={operationNotes} />
      <WorkflowSteps currentStep={step} steps={[{ id: "details", label: "Operation" }, { id: "review", label: "Review inventory change" }]} />
      {step === "details" ? <>
        <div className="worksheet-filter-grid">
          <label>
            <span className="metadata-label">Decision</span>
            <select className="worksheet-input" onChange={(event) => { setDecision(event.target.value as typeof decision); setAcknowledged(false); }} value={decision}>
              <option value="complete">{operationVerb} material</option>
              <option value="reject">Reject request</option>
            </select>
          </label>
          {decision === "complete" ? <label><span className="metadata-label">Operation date</span><Input type="date" required value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} /></label> : null}
          {decision === "complete" && request.requestType === "recover" ? <label><span className="metadata-label">Result</span><select className="worksheet-input" value={resultingStatus} onChange={(event) => setResultingStatus(event.target.value as typeof resultingStatus)}><option value="recovered">Recovered</option><option value="depleted">Depleted</option></select></label> : null}
        </div>
        {decision === "complete" ? (
        <div className="worksheet-filter-grid">
          <label><span className="metadata-label">Final location</span><Input required={request.requestType === "store"} value={storageLocation} onChange={(event) => setStorageLocation(event.target.value)} /></label>
          <label><span className="metadata-label">Final quantity</span><Input value={quantityLabel} onChange={(event) => setQuantityLabel(event.target.value)} /></label>
        </div>
      ) : null}
      <label className="grid gap-2 text-sm">
        <span className="metadata-label">{decision === "reject" ? "Rejection reason" : "Decision note"}</span>
        <Input minLength={decision === "reject" ? 3 : undefined} required={decision === "reject"} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {decision === "complete" ? (
        <label className="grid gap-2 text-sm">
          <span className="metadata-label">Operation notes</span>
          <textarea className="min-h-24 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-base text-[var(--ink)] outline-none focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm" value={operationNotes} onChange={(event) => setOperationNotes(event.target.value)} />
        </label>
      ) : null}
      <Button disabled={!canReview} onClick={() => setStep("review")} type="button" variant={decision === "reject" || request.requestType === "discard" ? "danger" : "default"}>Review {decision === "reject" ? "rejection" : request.requestType}</Button>
      </> : <>
        <WorkflowImpact title={decision === "reject" ? `Rejecting leaves ${label} unchanged.` : `${operationVerb} changes the authoritative inventory record.`} tone={decision === "complete" && request.requestType !== "discard" ? "warning" : "danger"}>
          <p>{decision === "reject" ? "The request will close with the rejection reason recorded." : `The inventory status becomes ${nextStatus}. ${request.requestType === "discard" ? "Discarded material cannot return to stored inventory." : "The operation and final location remain in history."}`}</p>
        </WorkflowImpact>
        <div className="metadata-grid"><div><span>Material</span><strong className="wrap-value">{label}</strong></div><div><span>Request</span><strong>{request.requestType}</strong></div><div><span>Decision</span><strong>{decision === "reject" ? "Reject" : operationVerb}</strong></div>{decision === "complete" ? <><div><span>Operation date</span><strong>{performedAt}</strong></div><div><span>Resulting status</span><strong>{nextStatus}</strong></div><div><span>Final location</span><strong className="wrap-value">{storageLocation || "Not recorded"}</strong></div><div><span>Final quantity</span><strong className="wrap-value">{quantityLabel || "Not recorded"}</strong></div></> : null}{reason ? <div className="md:col-span-2"><span>{decision === "reject" ? "Rejection reason" : "Decision note"}</span><strong className="wrap-value">{reason}</strong></div> : null}</div>
        {decision === "complete" && request.requestType === "discard" ? <label className="flex min-h-11 items-start gap-3 border border-red-300 bg-red-50/80 px-4 py-3 text-sm text-red-950"><input checked={acknowledged} className="mt-1 size-4" onChange={(event) => setAcknowledged(event.target.checked)} required type="checkbox" /><span>I confirm this material is being discarded and cannot return to stored inventory.</span></label> : null}
        <FormFeedback state={state} />
        <div className="flex flex-wrap justify-between gap-3"><Button disabled={pending || state.status === "success"} onClick={() => { setAcknowledged(false); setStep("details"); }} type="button" variant="ghost">Back</Button><Button disabled={pending || state.status === "success" || (decision === "complete" && request.requestType === "discard" && !acknowledged)} type="submit" variant={decision === "reject" || request.requestType === "discard" ? "danger" : "default"}>{pending ? "Saving..." : state.status === "success" ? "Request processed" : decision === "reject" ? `Reject ${label}` : `${operationVerb} ${label}`}</Button></div>
      </>}
    </form>
  );
}

export function CryostorageRequestWorkflow({ request, today }: { request: CryostorageRequestItem; today: string }) {
  return <ExecuteRequestForm request={request} today={today} />;
}

export function CryostorageRequestList({
  canCancelAll,
  canManage,
  canRequest,
  currentUserId,
  requests,
}: {
  canCancelAll: boolean;
  canManage: boolean;
  canRequest: boolean;
  currentUserId: string;
  requests: CryostorageRequestItem[];
}) {
  return (
    <section className="grid gap-3" data-testid="cryostorage-request-list">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-kicker">Requests</p>
          <h2 className="text-xl font-semibold text-[var(--ink)]">Storage operations</h2>
        </div>
        <span className="text-sm text-[var(--muted)]">{requests.filter((request) => request.status === "submitted").length} awaiting action</span>
      </div>
      {requests.length ? (
        <div className="row-list">
          {requests.map((request) => {
            const mayCancel = canRequest && (canCancelAll || request.requestedById === currentUserId);
            return (
              <article className="record-row" id={`request-${request.id}`} key={request.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="wrap-value font-semibold text-[var(--ink)]">{requestLabel(request)}</p>
                      <Badge variant={requestStatusVariant(request.status)}>{request.status}</Badge>
                      <Badge variant="neutral">{request.requestType}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {request.labLabel} · requested by {request.requestedByLabel} · for {formatDate(request.requestedFor)}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-[var(--muted)]">v{request.version}</span>
                </div>
                <dl className="metadata-grid mt-3">
                  <div><dt>Material</dt><dd>{request.materialType ?? request.targetRecordLabel ?? "Existing record"}</dd></div>
                  <div><dt>Strain</dt><dd>{request.strainName ?? "From inventory"}</dd></div>
                  <div><dt>Quantity</dt><dd>{request.requestedQuantityLabel ?? "Not specified"}</dd></div>
                  <div><dt>Location</dt><dd>{request.requestedStorageLocation ?? "To be assigned"}</dd></div>
                  {request.notes ? <div className="md:col-span-2"><dt>Notes</dt><dd className="wrap-value">{request.notes}</dd></div> : null}
                  {request.decisionReason ? <div className="md:col-span-2"><dt>Decision</dt><dd className="wrap-value">{request.decisionReason}</dd></div> : null}
                  {request.operation ? (
                    <div className="md:col-span-2">
                      <dt>Operation</dt>
                      <dd>{request.operation.previousStatus ? `${request.operation.previousStatus} → ` : ""}{request.operation.resultingStatus} · {formatDate(request.operation.performedAt)}</dd>
                    </div>
                  ) : null}
                </dl>
                {request.status === "submitted" && (canManage || mayCancel) ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canManage ? (
                      <Link className={request.requestType === "discard" ? "table-action table-action-danger" : "table-action table-action-primary"} href={`/cryostorage?requestId=${request.id}&action=process`}>{request.requestType === "store" ? "Store" : request.requestType === "recover" ? "Recover" : "Discard"} {requestLabel(request)}</Link>
                    ) : null}
                    {mayCancel ? (
                      <details className="min-w-[min(100%,18rem)] rounded-md border border-[var(--line)] bg-[var(--surface)] p-3">
                        <summary className="cursor-pointer font-semibold text-[var(--ink)]">Cancel</summary>
                        <div className="mt-3"><CancelRequestForm request={request} /></div>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[var(--line)] px-4 py-6 text-center text-sm text-[var(--muted)]">No cryostorage requests in the current lab scope.</div>
      )}
    </section>
  );
}
