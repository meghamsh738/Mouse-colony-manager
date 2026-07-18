import { randomUUID } from "node:crypto";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { CageIntakeWizard } from "@/components/app/cage-intake-wizard";
import { PageHeader } from "@/components/app/page-header";
import { getCageIntakeDraftView, getCageIntakeOptionsView } from "@/lib/cage-intake-read";
import { requireUser } from "@/lib/session";

type CageIntakePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function CageIntakePage({ searchParams }: CageIntakePageProps) {
  const user = await requireUser({ capability: "cages:manage" });
  const params = (await searchParams) ?? {};
  const requestedDraftId = getParam(params, "draftId");
  const initialDraft = requestedDraftId ? await getCageIntakeDraftView(user, requestedDraftId) : null;
  if (requestedDraftId && !initialDraft) notFound();
  const requestedMode = getParam(params, "mode");
  const mode = initialDraft?.payload.mode
    ?? (requestedMode === "wean" || requestedMode === "purchase" ? requestedMode : "new");
  const litterId = initialDraft?.payload.litterId ?? getParam(params, "litterId");
  const options = await getCageIntakeOptionsView(user, mode === "wean" ? litterId : undefined);

  return (
    <AppShell currentPath="/cages" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader
          actions={
            <Link className="table-action !min-h-11 inline-flex items-center gap-2 md:!min-h-9" href="/cages">
              <ArrowLeft aria-hidden="true" size={16} /> Cages
            </Link>
          }
          title="Cage intake"
        />
        <CageIntakeWizard
          mode={mode}
          options={options}
          initialDraft={initialDraft}
          workflowDraftId={initialDraft?.id ?? randomUUID()}
        />
      </div>
    </AppShell>
  );
}
