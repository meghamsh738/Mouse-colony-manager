import { TestTubeDiagonal } from "lucide-react";

import { AppShell } from "@/components/app/app-shell";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { PageHeader } from "@/components/app/page-header";
import { SampleCreateForm } from "@/components/app/sample-create-form";
import { SampleTable } from "@/components/app/sample-table";
import { WorksheetShell } from "@/components/app/worksheet-shell";
import { getSampleInventoryView, getSamplePageOptions } from "@/lib/samples-read";
import { requireUser } from "@/lib/session";

export default async function SamplesPage() {
  const user = await requireUser({ capability: "biosamples:read" });
  const canRecordSample = user.capabilities.includes("biosamples:manage");
  const [samples, options] = await Promise.all([
    getSampleInventoryView(user),
    canRecordSample ? getSamplePageOptions(user) : Promise.resolve(null),
  ]);
  const showRecordSample = canRecordSample && options !== null;
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
            summary={<span>{samples.length} biosamples in current view</span>}
            title="Inventory work"
          />
        ) : null}
        <WorksheetShell>
          <SampleTable canManage={canRecordSample} data={samples} experimentOptions={options?.experimentOptions ?? []} />
        </WorksheetShell>
      </div>
    </AppShell>
  );
}
