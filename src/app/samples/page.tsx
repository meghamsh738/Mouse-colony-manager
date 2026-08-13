import { TestTubeDiagonal } from "lucide-react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { PageHeader } from "@/components/app/page-header";
import { SampleCreateForm } from "@/components/app/sample-create-form";
import { SampleTable } from "@/components/app/sample-table";
import { WorksheetShell } from "@/components/app/worksheet-shell";
import {
  getSampleInventoryPageView,
  getSampleInventoryFilterOptions,
  getSamplePageOptions,
  SAMPLE_INVENTORY_DEFAULT_PAGE_SIZE,
} from "@/lib/samples-read";
import { requireUser } from "@/lib/session";

type SamplesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function canonicalSamplesHref(query: Awaited<ReturnType<typeof getSampleInventoryPageView>>["query"], page: number) {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.status !== "all") params.set("status", query.status);
  if (query.sampleType !== "all") params.set("sampleType", query.sampleType);
  if (query.experimentId !== "all") params.set("experimentId", query.experimentId);
  if (query.pageSize !== SAMPLE_INVENTORY_DEFAULT_PAGE_SIZE) params.set("pageSize", String(query.pageSize));
  if (page > 1) params.set("page", String(page));
  const serialized = params.toString();
  return serialized ? `/samples?${serialized}` : "/samples";
}

export default async function SamplesPage({ searchParams }: SamplesPageProps) {
  const user = await requireUser({ capability: "biosamples:read" });
  const canRecordSample = user.capabilities.includes("biosamples:manage");
  const rawQuery = (await searchParams) ?? {};
  const [inventory, options, filterOptions] = await Promise.all([
    getSampleInventoryPageView(user, rawQuery),
    canRecordSample ? getSamplePageOptions(user) : Promise.resolve(null),
    canRecordSample ? Promise.resolve(null) : getSampleInventoryFilterOptions(user),
  ]);
  if (inventory.page > inventory.pageCount) {
    redirect(canonicalSamplesHref(inventory.query, inventory.pageCount));
  }
  const samples = inventory.items;
  const showRecordSample = canRecordSample && options !== null;
  const experimentOptions = options?.experimentOptions ?? filterOptions?.experimentOptions ?? [];
  const defaultCollectedAt = (process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString()).slice(0, 10);
  const actions: CompactActionItem[] = showRecordSample
    ? [
        {
          id: "add-sample",
          label: "Add biosample",
          description: "Inventory record",
          icon: <TestTubeDiagonal size={16} />,
          tone: "primary",
          panel: (
            <SampleCreateForm
              animalOptions={options.animalOptions}
              projectOptions={options.projectOptions}
              experimentOptions={options.activeExperimentOptions}
              defaultAnimalId={options.animalOptions[0]?.id}
              defaultCollectedAt={defaultCollectedAt}
            />
          ),
        },
      ]
    : [];

  return (
    <AppShell currentPath="/samples" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader
          description="Animal-derived specimens and aliquots."
          title="Biosamples"
        />
        {showRecordSample ? (
          <CompactActionTray
            actions={actions}
            eyebrow="Actions"
            summary={<span>{inventory.totalCount} biosamples in current filtered view</span>}
            title="Inventory work"
          />
        ) : null}
        <WorksheetShell>
          <SampleTable
            canManage={canRecordSample}
            data={samples}
            experimentOptions={experimentOptions}
            key={JSON.stringify(inventory.query)}
            page={inventory.page}
            pageCount={inventory.pageCount}
            pageSize={inventory.pageSize}
            query={inventory.query}
            sampleTypes={inventory.sampleTypes}
            totalCount={inventory.totalCount}
          />
        </WorksheetShell>
      </div>
    </AppShell>
  );
}
