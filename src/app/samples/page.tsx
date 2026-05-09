import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { SampleCreateForm } from "@/components/app/sample-create-form";
import { SampleTable } from "@/components/app/sample-table";
import { Surface } from "@/components/app/surface";
import { getSampleInventoryView, getSamplePageOptions } from "@/lib/samples-read";
import { requireUser } from "@/lib/session";

export default async function SamplesPage() {
  const user = await requireUser();
  const [samples, options] = await Promise.all([getSampleInventoryView(), getSamplePageOptions()]);
  const canRecordSample = user.role !== "read_only";
  const defaultCollectedAt = (process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString()).slice(0, 10);

  return (
    <AppShell currentPath="/samples" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Sample inventory"
          title="Track tissues, DNA, and stored aliquots against real animals."
          description="This inventory stays tied to the colony record so stored material remains searchable by mouse, project, location, and lifecycle outcome."
        />
        <div className={canRecordSample ? "grid min-w-0 gap-6 xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]" : ""}>
          {canRecordSample ? (
            <div className="min-w-0 space-y-6">
              <Surface className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">New sample record</p>
                  <h2 className="font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                    Record one collected material entry with storage context.
                  </h2>
                  <p className="text-sm leading-7 text-[var(--muted)]">
                    Use this for tail DNA, serum, tissues, or endpoint material. The record stays linked to the mouse and any chargeable project without duplicating the animal history.
                  </p>
                </div>
                <SampleCreateForm
                  animalOptions={options.animalOptions}
                  projectOptions={options.projectOptions}
                  defaultAnimalId={options.animalOptions[0]?.id}
                  defaultCollectedAt={defaultCollectedAt}
                />
              </Surface>
            </div>
          ) : null}
          <Surface className="min-w-0">
            <SampleTable data={samples} />
          </Surface>
        </div>
      </div>
    </AppShell>
  );
}
