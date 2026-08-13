import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { CryostorageRequestForm, CryostorageRequestList, CryostorageRequestWorkflow } from "@/components/app/cryostorage-request-workspace";
import { CryostorageTable } from "@/components/app/cryostorage-table";
import { HighImpactWorkflowShell } from "@/components/app/high-impact-workflow-shell";
import { PageHeader } from "@/components/app/page-header";
import { WorksheetShell } from "@/components/app/worksheet-shell";
import { actorHasCapability } from "@/lib/capabilities";
import {
  CRYOSTORAGE_INVENTORY_DEFAULT_PAGE_SIZE,
  getCryostorageInventoryPageView,
  getCryostoragePageOptions,
  getCryostorageRequestTargets,
  getCryostorageRequestView,
} from "@/lib/cryostorage-read";
import { requireUser } from "@/lib/session";

type CryostoragePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function canonicalCryostorageHref(query: Awaited<ReturnType<typeof getCryostorageInventoryPageView>>["query"], page: number) {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.status !== "all") params.set("status", query.status);
  if (query.strainId !== "all") params.set("strainId", query.strainId);
  if (query.pageSize !== CRYOSTORAGE_INVENTORY_DEFAULT_PAGE_SIZE) params.set("pageSize", String(query.pageSize));
  if (page > 1) params.set("page", String(page));
  const serialized = params.toString();
  return serialized ? `/cryostorage?${serialized}` : "/cryostorage";
}

export default async function CryostoragePage({ searchParams }: CryostoragePageProps) {
  const user = await requireUser({ capability: "cryostorage:read" });
  const canRequest = actorHasCapability(user, "cryostorage:request");
  const canManage = actorHasCapability(user, "cryostorage:manage");
  const rawQuery = (await searchParams) ?? {};
  const requestsPromise = getCryostorageRequestView(user);
  const today = (process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString()).slice(0, 10);
  if (firstQueryValue(rawQuery.action) === "process") {
    const requests = await requestsPromise;
    const requestId = firstQueryValue(rawQuery.requestId);
    const request = requests.find((candidate) => candidate.id === requestId);
    if (!canManage || !request) notFound();
    const materialLabel = request.sampleLabel ?? request.targetRecordLabel ?? "Cryostorage request";
    return (
      <AppShell currentPath="/cryostorage" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
        <HighImpactWorkflowShell
          backHref={`/cryostorage#request-${request.id}`}
          backLabel="Cryostorage requests"
          context={[
            { label: "Material", value: materialLabel },
            { label: "Lab", value: request.labLabel },
            { label: "Request", value: request.requestType },
            { label: "Quantity", value: request.requestedQuantityLabel ?? "Not specified" },
          ]}
          description="Review the final inventory status, location, quantity, and irreversible effects before recording the storage operation."
          title={`${request.requestType === "store" ? "Store" : request.requestType === "recover" ? "Recover" : "Discard"} ${materialLabel}`}
        >
          {request.status === "submitted" ? <CryostorageRequestWorkflow request={request} today={today} /> : <div className="worksheet-empty"><strong>Cryostorage request processed</strong><p>This request is now {request.status}. The decision and operation remain in inventory history.</p></div>}
        </HighImpactWorkflowShell>
      </AppShell>
    );
  }
  const [inventory, options, requests, requestTargets] = await Promise.all([
    getCryostorageInventoryPageView(user, rawQuery),
    canRequest ? getCryostoragePageOptions(user) : Promise.resolve(null),
    requestsPromise,
    canRequest ? getCryostorageRequestTargets(user) : Promise.resolve([]),
  ]);
  if (inventory.page > inventory.pageCount) {
    redirect(canonicalCryostorageHref(inventory.query, inventory.pageCount));
  }
  const records = inventory.items;
  const showRequestForm = canRequest && options !== null;
  const defaultLabId = user.activeLabId ?? options?.labOptions[0]?.id ?? "";
  const actions: CompactActionItem[] = showRequestForm
    ? [
        {
          id: "request-cryostorage",
          label: "New request",
          description: "Storage operation",
          tone: "primary",
          panel: (
            <CryostorageRequestForm
              defaultLabId={defaultLabId}
              defaultRequestedFor={today}
              labOptions={options.labOptions}
              records={requestTargets}
              strainOptions={options.strainOptions}
              projectOptions={options.projectOptions}
            />
          ),
        },
      ]
    : [];

  return (
    <AppShell currentPath="/cryostorage" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader
          eyebrow="Cryostorage"
          title="Cryostorage"
        />
        {showRequestForm ? (
          <CompactActionTray
            actions={actions}
            eyebrow="Actions"
            summary={<span>{requests.filter((request) => request.status === "submitted").length} requests awaiting action</span>}
            title="Cryostorage request"
          />
        ) : null}
        <CryostorageRequestList
          canCancelAll={user.canonicalRole === "facility_admin" || user.activeMembership?.role === "owner" || user.activeMembership?.role === "manager"}
          canManage={canManage}
          canRequest={canRequest}
          currentUserId={user.id}
          requests={requests}
        />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="section-kicker">Inventory</p>
            <h2 className="text-xl font-semibold text-[var(--ink)]">Stored material</h2>
          </div>
          <span className="text-sm text-[var(--muted)]">{inventory.totalCount} records</span>
        </div>
        <WorksheetShell>
          <CryostorageTable
            canManage={canManage}
            data={records}
            key={JSON.stringify(inventory.query)}
            page={inventory.page}
            pageCount={inventory.pageCount}
            pageSize={inventory.pageSize}
            query={inventory.query}
            strainOptions={inventory.strainOptions}
            totalCount={inventory.totalCount}
          />
        </WorksheetShell>
      </div>
    </AppShell>
  );
}
