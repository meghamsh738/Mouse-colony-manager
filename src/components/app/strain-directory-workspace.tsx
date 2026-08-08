"use client";

import { useActionState, useMemo, useState } from "react";

import {
  createStrainDirectoryListingAction,
  decideStrainDirectoryRequestAction,
  submitStrainDirectoryRequestAction,
  updateStrainDirectoryListingAction,
} from "@/app/strains/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";
import type {
  StrainDirectoryItem,
  StrainDirectoryListingManagerItem,
  StrainDirectoryRequestItem,
} from "@/lib/strain-directory-read";

type Option = { id: string; label: string };
type ContactOption = { labId: string; userId: string; label: string };

function commandIdentity(prefix: string) {
  const nonce = crypto.randomUUID();
  return { idempotencyKey: `${prefix}:${nonce}`, requestId: `${prefix}:request:${nonce}` };
}

function CommandIdentityFields({ identity }: { identity: ReturnType<typeof commandIdentity> }) {
  return <><input name="idempotencyKey" type="hidden" value={identity.idempotencyKey} /><input name="requestId" type="hidden" value={identity.requestId} /></>;
}

function availabilityLabel(availability: StrainDirectoryItem["availability"]) {
  return {
    active_colony: "Active colony",
    cryopreserved: "Cryopreserved",
    active_and_cryopreserved: "Active colony + cryopreserved",
    availability_to_confirm: "Availability to confirm",
  }[availability];
}

function availabilityVariant(availability: StrainDirectoryItem["availability"]) {
  return availability === "availability_to_confirm" ? "warning" : "success";
}

function requestStatusVariant(status: StrainDirectoryRequestItem["status"]) {
  if (status === "accepted") return "success";
  if (status === "declined") return "danger";
  if (status === "submitted") return "info";
  return "neutral";
}

export function DirectoryRequestForm({ listing }: { listing: StrainDirectoryItem }) {
  const [state, action, pending] = useActionState(submitStrainDirectoryRequestAction, initialFormActionState);
  const [identity] = useState(() => commandIdentity(`strain-request:${listing.id}`));
  const handleSubmit = useSubmitGuard(pending);

  return (
    <form action={action} className="grid gap-3" onSubmit={handleSubmit}>
      <CommandIdentityFields identity={identity} />
      <input name="listingId" type="hidden" value={listing.id} />
      <p className="text-sm text-[var(--muted)]">This stays in the app. {listing.contactName}&rsquo;s email address and any animal-level inventory details remain private.</p>
      <label className="grid gap-1.5 text-sm">
        <span className="metadata-label">Request type</span>
        <select className="worksheet-input" defaultValue="contact" name="requestType">
          <option value="contact">Ask the directory contact to get in touch</option>
          <option value="material">Ask about material availability</option>
        </select>
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="metadata-label">Private note (optional)</span>
        <textarea className="min-h-20 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-base text-[var(--ink)] outline-none focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm" maxLength={500} name="purpose" placeholder="Briefly describe what your lab needs." />
      </label>
      <FormFeedback state={state} />
      <Button disabled={pending || state.status === "success"} type="submit" variant="subtle">{pending ? "Sending…" : state.status === "success" ? "Request sent" : "Send private request"}</Button>
    </form>
  );
}

export function StrainDirectoryDiscovery({ canRequest, listings }: { canRequest: boolean; listings: StrainDirectoryItem[] }) {
  if (!listings.length) {
    return <div className="worksheet-empty"><strong>No shared strains yet</strong><p>Labs can prepare a private draft, then the selected owner or manager confirms whether to share it unit-wide.</p></div>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="strain-directory-listings">
      {listings.map((listing) => (
        <article className="rounded-md border border-[var(--line)] bg-white p-4" key={listing.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><h3 className="wrap-value text-base font-semibold">{listing.strain.name}</h3><p className="mt-1 text-sm text-[var(--muted)]">{listing.strain.background || "Background not listed"}</p></div>
            <Badge variant={availabilityVariant(listing.availability)}>{availabilityLabel(listing.availability)}</Badge>
          </div>
          <dl className="mt-4 grid gap-2 text-sm"><div><dt className="metadata-label">Holding lab</dt><dd>{listing.lab.code} · {listing.lab.name}</dd></div><div><dt className="metadata-label">Directory contact</dt><dd>{listing.contactName}</dd></div></dl>
          {canRequest ? <details className="mt-4 border-t border-[var(--line)] pt-3"><summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">Request privately</summary><div className="mt-3"><DirectoryRequestForm listing={listing} /></div></details> : null}
        </article>
      ))}
    </div>
  );
}

export function CreateStrainDirectoryListingForm({ contacts, labs, strains }: { contacts: ContactOption[]; labs: Option[]; strains: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(createStrainDirectoryListingAction, initialFormActionState);
  const [identity] = useState(() => commandIdentity("strain-listing-create"));
  const [labId, setLabId] = useState(labs[0]?.id ?? "");
  const handleSubmit = useSubmitGuard(pending);
  const contactOptions = useMemo(() => contacts.filter((contact) => contact.labId === labId), [contacts, labId]);

  if (!labs.length) return null;
  return (
    <form action={action} className="grid gap-3" onSubmit={handleSubmit}>
      <CommandIdentityFields identity={identity} />
      <div className="worksheet-filter-grid">
        <label><span className="metadata-label">Holding lab</span><select className="worksheet-input" name="labId" onChange={(event) => setLabId(event.target.value)} value={labId}>{labs.map((lab) => <option key={lab.id} value={lab.id}>{lab.label}</option>)}</select></label>
        <label><span className="metadata-label">Canonical strain</span><select className="worksheet-input" name="strainId" required><option value="">Choose strain</option>{strains.map((strain) => <option key={strain.id} value={strain.id}>{strain.name}</option>)}</select></label>
        <label><span className="metadata-label">Directory contact</span><select className="worksheet-input" name="contactUserId" required><option value="">Choose owner or manager</option>{contactOptions.map((contact) => <option key={contact.userId} value={contact.userId}>{contact.label}</option>)}</select></label>
      </div>
      <p className="text-sm text-[var(--muted)]">New listings start as private drafts. Changing the contact later also returns the listing to draft until that contact confirms sharing.</p>
      <FormFeedback state={state} />
      <Button disabled={pending || !labId || !contactOptions.length || state.status === "success"} type="submit">{pending ? "Creating…" : state.status === "success" ? "Draft created" : "Create private draft"}</Button>
    </form>
  );
}

function ManageListingForm({ contacts, listing }: { contacts: ContactOption[]; listing: StrainDirectoryListingManagerItem }) {
  const [state, action, pending] = useActionState(updateStrainDirectoryListingAction, initialFormActionState);
  const [identity] = useState(() => commandIdentity(`strain-listing-update:${listing.id}:${listing.version}`));
  const handleSubmit = useSubmitGuard(pending);
  const contactOptions = contacts.filter((contact) => contact.labId === listing.labId);

  return (
    <form action={action} className="grid gap-3" onSubmit={handleSubmit}>
      <CommandIdentityFields identity={identity} />
      <input name="listingId" type="hidden" value={listing.id} />
      <input name="expectedVersion" type="hidden" value={listing.version} />
      <div className="worksheet-filter-grid">
        <label><span className="metadata-label">Directory contact</span><select className="worksheet-input" defaultValue={listing.contactUserId} name="contactUserId">{contactOptions.map((contact) => <option key={contact.userId} value={contact.userId}>{contact.label}</option>)}</select></label>
        <label><span className="metadata-label">Sharing state</span><select className="worksheet-input" defaultValue={listing.status} name="status"><option value="draft">Private draft</option><option value="shared">Shared unit-wide</option><option value="paused">Paused</option></select></label>
      </div>
      <p className="text-sm text-[var(--muted)]">Only the selected contact can confirm “Shared unit-wide.” Resolve pending requests before changing contacts; if the current contact is no longer active, another owner or manager can make an audited reassignment that returns the listing to a private draft. The directory never publishes animal, cage, storage-location, quantity, health, genotype, project, or free-text records.</p>
      <FormFeedback state={state} />
      <Button disabled={pending || state.status === "success"} type="submit" variant="subtle">{pending ? "Saving…" : state.status === "success" ? "Saved" : "Save listing"}</Button>
    </form>
  );
}

export function StrainDirectoryManagement({ contacts, listings }: { contacts: ContactOption[]; listings: StrainDirectoryListingManagerItem[] }) {
  if (!listings.length) return <p className="text-sm text-[var(--muted)]">No directory drafts or listings are managed in your current scope.</p>;
  return <div className="grid gap-3">{listings.map((listing) => <details className="rounded-md border border-[var(--line)] bg-white p-4" key={listing.id}><summary className="cursor-pointer"><span className="font-semibold">{listing.strainName}</span><span className="ml-2 text-sm text-[var(--muted)]">{listing.labLabel} · {listing.status}</span></summary><div className="mt-4"><ManageListingForm contacts={contacts} listing={listing} /></div></details>)}</div>;
}

function DecideDirectoryRequestForm({ request }: { request: StrainDirectoryRequestItem }) {
  const [state, action, pending] = useActionState(decideStrainDirectoryRequestAction, initialFormActionState);
  const [identity] = useState(() => commandIdentity(`strain-request-decide:${request.id}:${request.version}`));
  const [decision, setDecision] = useState<"accepted" | "declined">("accepted");
  const handleSubmit = useSubmitGuard(pending);
  return <form action={action} className="mt-3 grid gap-3 border-t border-[var(--line)] pt-3" onSubmit={handleSubmit}><CommandIdentityFields identity={identity} /><input name="strainDirectoryRequestId" type="hidden" value={request.id} /><input name="expectedVersion" type="hidden" value={request.version} /><label><span className="metadata-label">Response</span><select className="worksheet-input" name="action" onChange={(event) => setDecision(event.target.value as typeof decision)} value={decision}><option value="accepted">Accept</option><option value="declined">Decline</option></select></label><label className="grid gap-1.5 text-sm"><span className="metadata-label">Private response note {decision === "declined" ? "(required)" : "(optional)"}</span><Input minLength={decision === "declined" ? 3 : undefined} name="reason" required={decision === "declined"} /></label><FormFeedback state={state} /><Button disabled={pending || state.status === "success"} type="submit" variant={decision === "declined" ? "danger" : "subtle"}>{pending ? "Saving…" : state.status === "success" ? "Response sent" : decision === "accepted" ? "Accept request" : "Decline request"}</Button></form>;
}

function RequestCard({ request, incoming }: { request: StrainDirectoryRequestItem; incoming: boolean }) {
  return <article className="rounded-md border border-[var(--line)] bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{request.strainName}</h3><p className="mt-1 text-sm text-[var(--muted)]">{incoming ? `${request.requesterLabLabel} · ${request.requesterName}` : request.holdingLabLabel}</p></div><Badge variant={requestStatusVariant(request.status)}>{request.status}</Badge></div><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="metadata-label">Request</dt><dd>{request.requestType === "material" ? "Material availability" : "Contact"}</dd></div><div><dt className="metadata-label">Sent</dt><dd>{new Date(request.createdAt).toLocaleDateString()}</dd></div>{request.purpose ? <div className="sm:col-span-2"><dt className="metadata-label">Private note</dt><dd className="wrap-value">{request.purpose}</dd></div> : null}{request.decisionReason ? <div className="sm:col-span-2"><dt className="metadata-label">Response note</dt><dd className="wrap-value">{request.decisionReason}</dd></div> : null}</dl>{incoming && request.status === "submitted" ? <DecideDirectoryRequestForm request={request} /> : null}</article>;
}

export function StrainDirectoryRequests({ received, sent }: { received: StrainDirectoryRequestItem[]; sent: StrainDirectoryRequestItem[] }) {
  return <div className="grid gap-5 xl:grid-cols-2"><section><div className="mb-3"><p className="section-kicker">Private inbox</p><h2 className="text-lg font-semibold">Requests for your listings</h2></div>{received.length ? <div className="grid gap-3">{received.map((request) => <RequestCard incoming key={request.id} request={request} />)}</div> : <p className="text-sm text-[var(--muted)]">No requests are assigned to you as directory contact.</p>}</section><section><div className="mb-3"><p className="section-kicker">Private outbox</p><h2 className="text-lg font-semibold">Requests your account sent</h2></div>{sent.length ? <div className="grid gap-3">{sent.map((request) => <RequestCard incoming={false} key={request.id} request={request} />)}</div> : <p className="text-sm text-[var(--muted)]">You have not sent any directory requests.</p>}</section></div>;
}
