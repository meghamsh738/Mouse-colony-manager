"use client";

import { Ban, Check, RefreshCw, Send, ShieldAlert, X } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import {
  cancelLabTransferAction,
  decideLabTransferAction,
  finalizeLabTransferAction,
  requestLabTransferAction,
  reviseLabTransferAction,
} from "@/app/approvals/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";
import type { getLabTransferWorkspace } from "@/lib/lab-transfer-read";

type TransferRequestRow = Awaited<ReturnType<typeof getLabTransferWorkspace>>["requests"][number];
type LabOption = { id: string; name: string; code: string };
type ProtocolOption = { id: string; labId: string; label: string; validUntil: string };

function statusLabel(status: TransferRequestRow["status"]) {
  return {
    requested: "Destination review",
    destination_accepted: "CMU finalization",
    destination_rejected: "Revision needed",
    cancelled: "Cancelled",
    finalized: "Finalized",
  }[status];
}

function statusVariant(status: TransferRequestRow["status"]): "info" | "success" | "warning" | "neutral" {
  if (status === "finalized") return "success";
  if (status === "destination_accepted") return "info";
  if (status === "destination_rejected") return "warning";
  if (status === "cancelled") return "neutral";
  return "info";
}

export function LabTransferRequestForm({
  subjectType,
  sourceCageId,
  animalIds = [],
  destinationLabs,
  sourceProtocols,
  nonce,
  today,
}: {
  subjectType: "cage" | "animals";
  sourceCageId?: string;
  animalIds?: string[];
  destinationLabs: LabOption[];
  sourceProtocols: ProtocolOption[];
  nonce: string;
  today: string;
}) {
  const [state, action, pending] = useActionState(requestLabTransferAction, initialFormActionState);
  const [destinationLabId, setDestinationLabId] = useState(destinationLabs[0]?.id ?? "");
  const [requestedEffectiveAt, setRequestedEffectiveAt] = useState(today);
  const [reason, setReason] = useState("");
  const [sourcePrivateNote, setSourcePrivateNote] = useState("");
  const [sourceProtocolAuthorizationId, setSourceProtocolAuthorizationId] = useState("");
  const commandKey = useMemo(
    () => `${nonce}:request:${subjectType}:${sourceCageId ?? animalIds.join(",")}:${destinationLabId}:${sourceProtocolAuthorizationId}:${requestedEffectiveAt}:${reason}`,
    [animalIds, destinationLabId, nonce, reason, requestedEffectiveAt, sourceCageId, sourceProtocolAuthorizationId, subjectType],
  );

  if (!destinationLabs.length) {
    return <p className="text-sm text-[var(--muted)]">No other active lab is available.</p>;
  }

  return (
    <form action={action} className="space-y-4" data-testid="lab-transfer-request-form">
      <input name="subjectType" type="hidden" value={subjectType} />
      <input name="sourceCageId" type="hidden" value={sourceCageId ?? ""} />
      <input name="animalIdsJson" type="hidden" value={JSON.stringify(animalIds)} />
      <input name="idempotencyKey" type="hidden" value={commandKey} />
      <input name="requestId" type="hidden" value={commandKey} />
      <div className={sourceProtocols.length ? "rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" : "rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"}>
        {sourceProtocols.length
          ? "Choose the source-lab authorization that covers every transferred strain and names you as a transfer coordinator. The server verifies the current scope again."
          : "No active source-lab transfer authorization names you. The request is blocked until an independent reviewer activates a matching protocol and your competency is current."}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm md:col-span-2">
          <span className="text-[var(--muted)]">Source transfer protocol</span>
          <select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" name="sourceProtocolAuthorizationId" required value={sourceProtocolAuthorizationId} onChange={(event) => setSourceProtocolAuthorizationId(event.target.value)}>
            <option value="">Choose active protocol</option>
            {sourceProtocols.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.label} · expires {protocol.validUntil.slice(0, 10)}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Destination lab</span>
          <select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" name="destinationLabId" value={destinationLabId} onChange={(event) => setDestinationLabId(event.target.value)}>
            {destinationLabs.map((lab) => <option key={lab.id} value={lab.id}>{lab.code} · {lab.name}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Earliest transfer date</span>
          <Input min={today} name="requestedEffectiveAt" required type="date" value={requestedEffectiveAt} onChange={(event) => setRequestedEffectiveAt(event.target.value)} />
        </label>
      </div>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Handover reason</span>
        <textarea className="min-h-20 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2" name="reason" required value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Source-lab note</span>
        <textarea className="min-h-16 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2" name="sourcePrivateNote" value={sourcePrivateNote} onChange={(event) => setSourcePrivateNote(event.target.value)} />
        <span className="block text-xs text-[var(--muted)]">Hidden from the destination lab and CMU packet.</span>
      </label>
      <FormFeedback state={state} />
      <Button disabled={pending || reason.trim().length < 3 || !destinationLabId || !sourceProtocolAuthorizationId} type="submit">
        <Send size={16} />{pending ? "Sending..." : "Request transfer"}
      </Button>
    </form>
  );
}

function DestinationDecisionForm({ request, nonce }: { request: TransferRequestRow; nonce: string }) {
  const [state, action, pending] = useActionState(decideLabTransferAction, initialFormActionState);
  const [decision, setDecision] = useState<"accept" | "reject">("accept");
  const [destinationCageId, setDestinationCageId] = useState(request.destinationCages[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [destinationProtocolAuthorizationId, setDestinationProtocolAuthorizationId] = useState("");
  const commandKey = `${nonce}:decide:${request.id}:${request.version}:${decision}:${destinationCageId}:${destinationProtocolAuthorizationId}:${note}`;
  return (
    <form action={action} className="space-y-4">
      <input name="transferRequestId" type="hidden" value={request.id} />
      <input name="expectedVersion" type="hidden" value={request.version} />
      <input name="idempotencyKey" type="hidden" value={commandKey} />
      <input name="requestId" type="hidden" value={commandKey} />
      {decision === "accept" ? <div className={request.destinationProtocols.length ? "rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" : "rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"}>
        {request.destinationProtocols.length
          ? "Acceptance requires a separate destination-lab authorization covering the transferred strains and naming you as transfer coordinator."
          : "No matching destination-lab transfer authorization is active. Acceptance is blocked; you may reject with a reason or arrange independent protocol activation."}
      </div> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {decision === "accept" ? <label className="space-y-2 text-sm md:col-span-2">
          <span className="text-[var(--muted)]">Destination transfer protocol</span>
          <select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" name="destinationProtocolAuthorizationId" required value={destinationProtocolAuthorizationId} onChange={(event) => setDestinationProtocolAuthorizationId(event.target.value)}>
            <option value="">Choose active protocol</option>
            {request.destinationProtocols.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.label} · expires {protocol.validUntil.slice(0, 10)}</option>)}
          </select>
        </label> : <input name="destinationProtocolAuthorizationId" type="hidden" value="" />}
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Decision</span>
          <select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" name="decision" value={decision} onChange={(event) => setDecision(event.target.value as typeof decision)}>
            <option value="accept">Accept</option>
            <option value="reject">Reject</option>
          </select>
        </label>
        {request.subjectType === "animals" && decision === "accept" ? (
          <label className="space-y-2 text-sm">
            <span className="text-[var(--muted)]">Destination cage</span>
            <select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" name="destinationCageId" required value={destinationCageId} onChange={(event) => setDestinationCageId(event.target.value)}>
              <option value="">Choose cage</option>
              {request.destinationCages.map((cage) => (
                <option disabled={cage.capacity - cage.occupancy < request.animalCount} key={cage.id} value={cage.id}>
                  {cage.barcode} · {cage.location} · {cage.occupancy}/{cage.capacity}
                </option>
              ))}
            </select>
          </label>
        ) : <input name="destinationCageId" type="hidden" value="" />}
      </div>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Decision note</span>
        <textarea className="min-h-16 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2" name="note" required={decision === "reject"} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <FormFeedback state={state} />
      <Button disabled={pending || (decision === "accept" && (!destinationProtocolAuthorizationId || (request.subjectType === "animals" && !destinationCageId)))} type="submit" variant={decision === "reject" ? "warning" : "default"}>
        {decision === "accept" ? <Check size={16} /> : <X size={16} />}{pending ? "Saving..." : decision === "accept" ? `Accept transfer into ${request.destinationLab.code}` : `Reject transfer into ${request.destinationLab.code}`}
      </Button>
    </form>
  );
}

function RevisionForm({ request, destinationLabs, nonce, sourceProtocols }: { request: TransferRequestRow; destinationLabs: LabOption[]; nonce: string; sourceProtocols: ProtocolOption[] }) {
  const [state, action, pending] = useActionState(reviseLabTransferAction, initialFormActionState);
  const [destinationLabId, setDestinationLabId] = useState(request.destinationLab.id);
  const [requestedEffectiveAt, setRequestedEffectiveAt] = useState(request.requestedEffectiveAt.toISOString().slice(0, 10));
  const [reason, setReason] = useState(request.reason);
  const [sourcePrivateNote, setSourcePrivateNote] = useState(request.sourcePrivateNote ?? "");
  const [sourceProtocolAuthorizationId, setSourceProtocolAuthorizationId] = useState("");
  const commandKey = `${nonce}:revise:${request.id}:${request.version}:${destinationLabId}:${sourceProtocolAuthorizationId}:${requestedEffectiveAt}:${reason}`;
  return (
    <form action={action} className="space-y-4">
      <input name="transferRequestId" type="hidden" value={request.id} />
      <input name="expectedVersion" type="hidden" value={request.version} />
      <input name="idempotencyKey" type="hidden" value={commandKey} />
      <input name="requestId" type="hidden" value={commandKey} />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm md:col-span-2"><span className="text-[var(--muted)]">Source transfer protocol</span><select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" name="sourceProtocolAuthorizationId" required value={sourceProtocolAuthorizationId} onChange={(event) => setSourceProtocolAuthorizationId(event.target.value)}><option value="">Choose active protocol</option>{sourceProtocols.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.label} · expires {protocol.validUntil.slice(0, 10)}</option>)}</select></label>
        <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Destination lab</span><select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" name="destinationLabId" value={destinationLabId} onChange={(event) => setDestinationLabId(event.target.value)}>{destinationLabs.map((lab) => <option key={lab.id} value={lab.id}>{lab.code} · {lab.name}</option>)}</select></label>
        <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Earliest date</span><Input name="requestedEffectiveAt" required type="date" value={requestedEffectiveAt} onChange={(event) => setRequestedEffectiveAt(event.target.value)} /></label>
      </div>
      <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Handover reason</span><textarea className="min-h-16 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2" name="reason" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Source-lab note</span><textarea className="min-h-16 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2" name="sourcePrivateNote" value={sourcePrivateNote} onChange={(event) => setSourcePrivateNote(event.target.value)} /></label>
      <p className="text-xs text-amber-800">Submitting creates a new packet version and clears any earlier destination acceptance.</p>
      <FormFeedback state={state} />
      <Button disabled={pending || reason.trim().length < 3 || !sourceProtocolAuthorizationId} type="submit" variant="warning"><RefreshCw size={16} />{pending ? "Refreshing..." : "Revise packet"}</Button>
    </form>
  );
}

function CancelForm({ request, nonce }: { request: TransferRequestRow; nonce: string }) {
  const [state, action, pending] = useActionState(cancelLabTransferAction, initialFormActionState);
  const [reason, setReason] = useState("");
  const commandKey = `${nonce}:cancel:${request.id}:${request.version}:${reason}`;
  return (
    <form action={action} className="space-y-3">
      <input name="transferRequestId" type="hidden" value={request.id} /><input name="expectedVersion" type="hidden" value={request.version} /><input name="idempotencyKey" type="hidden" value={commandKey} /><input name="requestId" type="hidden" value={commandKey} />
      <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Cancellation reason</span><Input name="reason" required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <FormFeedback state={state} />
      <Button disabled={pending || reason.trim().length < 3} type="submit" variant="danger"><Ban size={16} />{pending ? "Cancelling..." : "Cancel request"}</Button>
    </form>
  );
}

function FinalizeForm({ request, nonce }: { request: TransferRequestRow; nonce: string }) {
  const [state, action, pending] = useActionState(finalizeLabTransferAction, initialFormActionState);
  const [overrideReason, setOverrideReason] = useState("");
  const blockerTotal = request.blockers.experiments + request.blockers.projects + request.blockers.breeding;
  const commandKey = `${nonce}:finalize:${request.id}:${request.version}:${overrideReason}`;
  return (
    <form action={action} className="space-y-4">
      <input name="transferRequestId" type="hidden" value={request.id} /><input name="expectedVersion" type="hidden" value={request.version} /><input name="idempotencyKey" type="hidden" value={commandKey} /><input name="requestId" type="hidden" value={commandKey} />
      <div className={blockerTotal ? "border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950" : "border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"}>
        <strong>{blockerTotal ? `${blockerTotal} active relationships block finalization` : "Packet accepted and ready"}</strong>
        <p className="mt-1">Experiments {request.blockers.experiments} · Projects {request.blockers.projects} · Breeding {request.blockers.breeding}</p>
      </div>
      {blockerTotal && request.actions.canOverride ? <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Facility override reason</span><textarea className="min-h-20 w-full rounded-md border border-red-300 bg-white px-3 py-2" name="overrideReason" required value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /><span className="block text-xs text-red-800">This cancels active assignments, ends allocations, and retires affected breeding setups.</span></label> : <input name="overrideReason" type="hidden" value="" />}
      {blockerTotal && !request.actions.canOverride ? <p className="text-sm text-amber-900">Facility Admin review is required before CMU can complete this transfer.</p> : null}
      <FormFeedback state={state} />
      <Button disabled={pending || (blockerTotal > 0 && (!request.actions.canOverride || overrideReason.trim().length < 10))} type="submit" variant={blockerTotal ? "danger" : "default"}><ShieldAlert size={16} />{pending ? "Finalizing..." : blockerTotal ? `Override blockers and finalize transfer to ${request.destinationLab.code}` : `Finalize transfer to ${request.destinationLab.code}`}</Button>
    </form>
  );
}

export function LabTransferWorkspace({ requests, destinationLabs, nonce, sourceProtocols }: { requests: TransferRequestRow[]; destinationLabs: LabOption[]; nonce: string; sourceProtocols: ProtocolOption[] }) {
  if (!requests.length) return <div className="worksheet-empty"><strong>No transfer requests</strong><p>Source-lab requests will appear here for destination review and CMU finalization.</p></div>;
  return (
    <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]" data-testid="lab-transfer-workspace">
      {requests.map((request) => {
        const packetAnimals = request.packet?.animals ?? [];
        return (
          <article className="py-4" id={`transfer-${request.id}`} key={request.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><strong className="wrap-value">{request.sourceLab.code} → {request.destinationLab.code}</strong><Badge variant={statusVariant(request.status)}>{statusLabel(request.status)}</Badge><span className="text-xs text-[var(--muted)]">Packet v{request.packetVersion}</span></div>
                <p className="mt-1 text-sm text-[var(--muted)]">{request.subjectType === "cage" ? request.sourceCage?.barcode ?? "Cage" : `${packetAnimals.length} animals`} · requested {request.requestedAt.toISOString().slice(0, 10)} · earliest {request.requestedEffectiveAt.toISOString().slice(0, 10)}</p>
              </div>
              <span className="text-xs text-[var(--muted)]">{request.id.slice(0, 8)}</span>
            </div>
            <p className="mt-3 text-sm">{request.reason}</p>
            {request.sourcePrivateNote ? <p className="mt-2 border-l-2 border-[var(--line-strong)] pl-3 text-xs text-[var(--muted)]"><strong>Source only:</strong> {request.sourcePrivateNote}</p> : null}
            <details className="mt-3 border-t border-[var(--line)] pt-3">
              <summary className="cursor-pointer text-sm font-semibold">Packet details</summary>
              <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                <div><span className="block text-xs text-[var(--muted)]">Source</span><strong>{request.sourceCage?.barcode ?? `${packetAnimals.length} selected animals`}</strong></div>
                <div><span className="block text-xs text-[var(--muted)]">Destination</span><strong>{request.destinationCage?.barcode ?? request.destinationLab.name}</strong></div>
                <div><span className="block text-xs text-[var(--muted)]">Acceptance</span><strong>{request.acceptedPacketVersion ? `Packet v${request.acceptedPacketVersion}` : "Pending"}</strong></div>
              </div>
              {packetAnimals.length ? <div className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">{packetAnimals.map((animal) => <div className="grid gap-1 py-2 text-xs md:grid-cols-[8rem_7rem_1fr_1fr]" key={animal.id}><strong>{animal.facilityAnimalId}</strong><span>{animal.sex}</span><span>{animal.strain}</span><span>{animal.sourceCageBarcode ?? "Unassigned"}</span></div>)}</div> : null}
            </details>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {request.actions.canDecide ? <details className="border-t border-[var(--line)] pt-3" open><summary className="cursor-pointer text-sm font-semibold">Destination decision</summary><div className="mt-3"><DestinationDecisionForm nonce={nonce} request={request} /></div></details> : null}
              {request.actions.canFinalize ? <details className="border-t border-[var(--line)] pt-3" open><summary className="cursor-pointer text-sm font-semibold">CMU finalization</summary><div className="mt-3"><FinalizeForm nonce={nonce} request={request} /></div></details> : null}
              {request.actions.canRevise ? <details className="border-t border-[var(--line)] pt-3"><summary className="cursor-pointer text-sm font-semibold">Revise packet</summary><div className="mt-3"><RevisionForm destinationLabs={destinationLabs} nonce={nonce} request={request} sourceProtocols={sourceProtocols} /></div></details> : null}
              {request.actions.canCancel ? <details className="border-t border-[var(--line)] pt-3"><summary className="cursor-pointer text-sm font-semibold text-red-800">Cancel request</summary><div className="mt-3"><CancelForm nonce={nonce} request={request} /></div></details> : null}
            </div>
            {request.events.length ? <details className="mt-4 border-t border-[var(--line)] pt-3"><summary className="cursor-pointer text-sm font-semibold">History</summary><div className="mt-2 divide-y divide-[var(--line)]">{request.events.map((event) => <div className="flex flex-wrap justify-between gap-2 py-2 text-xs" key={event.id}><span><strong>{event.eventType.replaceAll("_", " ")}</strong> · {event.actor.name}</span><span className="text-[var(--muted)]">{event.createdAt.toISOString().slice(0, 16).replace("T", " ")} · packet v{event.packetVersion}</span></div>)}</div></details> : null}
          </article>
        );
      })}
    </div>
  );
}
