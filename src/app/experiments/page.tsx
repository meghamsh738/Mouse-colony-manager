import { AppShell } from "@/components/app/app-shell";
import { ExperimentRegistry } from "@/components/app/experiment-registry";
import { ExperimentsWorksheet } from "@/components/app/experiments-worksheet";
import { OperationalExperimentsWorksheet } from "@/components/app/operational-experiments-worksheet";
import { PageHeader } from "@/components/app/page-header";
import {
  getExperimentOverviewView,
  getExperimentPlannerOptions,
  getExperimentPlannerView,
  parseExperimentPlannerFilters,
} from "@/lib/experiments-read";
import { getExperimentRegistryOptions } from "@/lib/experiments-write";
import { requireUser } from "@/lib/session";

type ExperimentsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ExperimentsPage({ searchParams }: ExperimentsPageProps) {
  const user = await requireUser({ capability: "experiments:read" });
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const canReadFull = user.capabilities.includes("experiments:full");
  const canManage = user.capabilities.includes("experiments:manage");
  const [overview, fullWorkspace] = await Promise.all([
    getExperimentOverviewView(user),
    canReadFull
      ? Promise.all([
          getExperimentPlannerView(user, parseExperimentPlannerFilters(resolvedSearchParams)),
          getExperimentPlannerOptions(user),
          canManage ? getExperimentRegistryOptions(user) : Promise.resolve({ labOptions: [], projectOptions: [], protocolOptions: [] }),
        ])
      : Promise.resolve(null),
  ]);

  return (
    <AppShell currentPath="/experiments" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader eyebrow="Experiments" title="Experiments" />
        {fullWorkspace ? (
          <>
            <ExperimentRegistry
              experiments={overview}
              canManage={canManage}
              labOptions={fullWorkspace[2].labOptions}
              projectOptions={fullWorkspace[2].projectOptions}
              protocolOptions={fullWorkspace[2].protocolOptions}
            />
            <ExperimentsWorksheet overview={overview} options={fullWorkspace[1]} planner={fullWorkspace[0]} />
          </>
        ) : (
          <OperationalExperimentsWorksheet overview={overview} />
        )}
      </div>
    </AppShell>
  );
}
