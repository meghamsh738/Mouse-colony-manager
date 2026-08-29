import { AppShell } from "@/components/app/app-shell";
import { BreedingSetupForm } from "@/components/app/breeding-setup-form";
import { BreedingWorksheet } from "@/components/app/breeding-worksheet";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { PageHeader } from "@/components/app/page-header";
import {
  getBreedingOverviewView,
  getBreedingSetupOptionsView,
  getBreedingSuggestionSummaryView,
} from "@/lib/breeding-read";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export default async function BreedingPage() {
  const user = await requireUser({ capability: "breeding:read" });
  const [breedings, suggestions, options, protocolOptions] = await Promise.all([
    getBreedingOverviewView(user),
    getBreedingSuggestionSummaryView(user),
    getBreedingSetupOptionsView(user),
    prisma.protocolAuthorization.findMany({
      where: {
        status: "active",
        ...(user.activeLabId ? { labId: user.activeLabId } : {}),
        currentVersion: {
          validFrom: { lte: new Date() },
          validUntil: { gt: new Date() },
          procedureBindings: { some: { procedureCode: "breeding" } },
          personnelBindings: {
            some: { userId: user.id, roleLabel: "breeding_operator" },
          },
        },
      },
      orderBy: [{ lab: { code: "asc" } }, { protocolCode: "asc" }],
      select: {
        id: true,
        protocolCode: true,
        title: true,
        lab: { select: { code: true } },
        currentVersion: { select: { validUntil: true } },
      },
      take: 100,
    }),
  ]);
  const canCreateBreeding = user.role !== "read_only";
  const canOverride = user.role === "admin";
  const canRecordLitter = user.role !== "read_only";
  const defaultBirthDate = (process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString()).slice(0, 10);
  const actions: CompactActionItem[] = canCreateBreeding
    ? [
        {
          id: "create-setup",
          label: "Create setup",
          description: "New pairing",
          tone: "primary",
          panel: (
            <BreedingSetupForm
              allowOverride={canOverride}
              damOptions={options.damOptions}
              protocolOptions={protocolOptions.map((protocol) => ({
                id: protocol.id,
                label: `${protocol.lab.code} · ${protocol.protocolCode} — ${protocol.title}`,
                validUntil: protocol.currentVersion!.validUntil.toISOString(),
              }))}
              sireOptions={options.sireOptions}
            />
          ),
        },
      ]
    : [];

  return (
    <AppShell currentPath="/breeding" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader eyebrow="Breeding" title="Breeding" />
        {canCreateBreeding ? (
          <CompactActionTray
            actions={actions}
            eyebrow="Actions"
            summary={<span>{breedings.length} breeding setups</span>}
            title="Breeding work"
          />
        ) : null}
        <BreedingWorksheet
          breedings={breedings}
          canRecordLitter={canRecordLitter}
          defaultBirthDate={defaultBirthDate}
          suggestions={suggestions}
        />
      </div>
    </AppShell>
  );
}
