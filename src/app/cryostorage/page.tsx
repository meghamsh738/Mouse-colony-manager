import { AppShell } from "@/components/app/app-shell";
import { CryostorageCreateForm } from "@/components/app/cryostorage-create-form";
import { CryostorageTable } from "@/components/app/cryostorage-table";
import { PageHeader } from "@/components/app/page-header";
import { Surface } from "@/components/app/surface";
import { getCryostorageInventoryView, getCryostoragePageOptions } from "@/lib/cryostorage-read";
import { requireUser } from "@/lib/session";

export default async function CryostoragePage() {
  const user = await requireUser();
  const [records, options] = await Promise.all([getCryostorageInventoryView(), getCryostoragePageOptions()]);
  const canRecordCryostorage = user.role !== "read_only";
  const defaultStoredAt = (process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString()).slice(0, 10);

  return (
    <AppShell currentPath="/cryostorage" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Cryostorage"
          title="Track frozen backup material and archived recovery lines."
          description="This workspace keeps frozen sperm, embryos, and reserve material tied to strains and projects so line recovery planning stays visible alongside the active colony."
        />
        <div className={canRecordCryostorage ? "grid gap-6 xl:grid-cols-[0.8fr_1.2fr]" : ""}>
          {canRecordCryostorage ? (
            <div className="space-y-6">
              <Surface className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">New cryostorage record</p>
                  <h2 className="font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                    Capture frozen backup inventory with enough context to recover a line later.
                  </h2>
                  <p className="text-sm leading-7 text-[var(--muted)]">
                    Record the material type, storage position, current recovery status, and any notes about when that line should be brought back into the colony.
                  </p>
                </div>
                <CryostorageCreateForm
                  strainOptions={options.strainOptions}
                  projectOptions={options.projectOptions}
                  defaultStoredAt={defaultStoredAt}
                />
              </Surface>
            </div>
          ) : null}
          <Surface>
            <CryostorageTable data={records} />
          </Surface>
        </div>
      </div>
    </AppShell>
  );
}
