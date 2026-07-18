import { randomUUID } from "node:crypto";

import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { ProcedureWorkspace } from "@/components/app/procedure-workspace";
import { StatStrip } from "@/components/app/stat-strip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getProcedureWorkspace } from "@/lib/procedure-read";
import { requireUser } from "@/lib/session";

type ProceduresPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function localDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

export default async function ProceduresPage({ searchParams }: ProceduresPageProps) {
  const user = await requireUser({ capability: "procedures:operational" });
  const query = searchParams ? await searchParams : {};
  const search = param(query.search);
  const status = param(query.status) || "all";
  const workspace = await getProcedureWorkspace(user, { search, status });
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  tomorrow.setHours(9, 0, 0, 0);

  return (
    <AppShell currentPath="/procedures" role={user.role} userName={user.name ?? user.email}>
      <div className="space-y-5">
        <PageHeader eyebrow="Research operations" title="Procedures" />
        <StatStrip stats={[
          { label: "Planned", value: workspace.summary.planned, emphasis: "info" },
          { label: "Due", value: workspace.summary.due, emphasis: workspace.summary.due ? "warning" : "neutral" },
          { label: "Completed", value: workspace.summary.completed, emphasis: "success" },
          { label: "Cancelled", value: workspace.summary.cancelled },
        ]} />
        <form className="worksheet-toolbar" method="get">
          <Input aria-label="Search procedures" defaultValue={search} name="search" placeholder="Search procedure, experiment, animal, or cage" />
          <select className="h-11 rounded-md border border-[var(--line)] bg-white px-3 text-sm" defaultValue={status} name="status">
            <option value="all">All statuses</option><option value="planned">Planned</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        <ProcedureWorkspace
          assignments={workspace.assignmentOptions}
          canExecute={workspace.permissions.canExecute}
          canPlan={workspace.permissions.canPlan}
          defaultOccurredAt={localDateTime(now)}
          defaultScheduledAt={localDateTime(tomorrow)}
          nonce={randomUUID()}
          planId={randomUUID()}
          rows={workspace.rows}
          sops={workspace.sopOptions}
        />
      </div>
    </AppShell>
  );
}
