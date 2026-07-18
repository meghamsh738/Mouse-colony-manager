import { AppShell } from "@/components/app/app-shell";
import { WorkbookView } from "@/components/app/workbook-view";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  canonicalizeWorkbookState,
  getWorkbookNavigation,
  getWorkbookSheet,
  parseWorkbookState,
  workbookRawStateNeedsRedirect,
  workbookStateHref,
} from "@/lib/workbook-read";

type WorkbookPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function WorkbookPage({ searchParams }: WorkbookPageProps) {
  const user = await requireUser({ capability: "workbook:read" });
  const rawSearchParams = searchParams ? await searchParams : undefined;
  const state = parseWorkbookState(rawSearchParams);
  if (state.section === "experiments" && !user.capabilities.includes("experiments:full")) {
    redirect("/access-denied");
  }
  if (state.section === "biosamples" && !user.capabilities.includes("biosamples:read")) {
    redirect("/access-denied");
  }
  const actor = {
    id: user.id,
    role: user.role,
    activeLabId: user.activeLabId,
    canonicalRole: user.canonicalRole,
    capabilities: user.capabilities,
  };
  const navigation = await getWorkbookNavigation(actor, state);
  const canonicalState = canonicalizeWorkbookState(state, navigation);
  if (
    canonicalState.sheet !== state.sheet
    || canonicalState.labId !== state.labId
    || workbookRawStateNeedsRedirect(rawSearchParams, canonicalState)
  ) {
    redirect(workbookStateHref(canonicalState));
  }
  const sheet = await getWorkbookSheet(actor, canonicalState);

  return (
    <AppShell currentPath="/workbook" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <WorkbookView navigation={navigation} sheet={sheet} state={canonicalState} />
    </AppShell>
  );
}
