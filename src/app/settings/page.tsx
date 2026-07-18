import Link from "next/link";

import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { RuleConfigEditor } from "@/components/app/rule-config-editor";
import { MobileWorksheetCard, WorksheetShell } from "@/components/app/worksheet-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/session";
import { getOperationalAuditHistoryView, getRuleSummaryView } from "@/lib/settings-read";
import { formatDate } from "@/lib/utils";

type SettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const auditQuery = first(params?.auditQuery)?.trim() ?? "";
  const auditEntity = first(params?.auditEntity)?.trim() ?? "";
  const auditCursor = first(params?.auditCursor)?.trim() || null;
  const user = await requireUser({ capability: "rules:manage" });
  const [rules, auditHistory] = await Promise.all([
    getRuleSummaryView(),
    getOperationalAuditHistoryView(user, { cursor: auditCursor, query: auditQuery, entityType: auditEntity }),
  ]);
  const auditLogs = auditHistory.items;
  const canEditRules = user.canonicalRole === "facility_admin";
  const auditExportTo = new Date();
  const auditExportFrom = new Date(auditExportTo.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const auditExportParams = new URLSearchParams({
    from: auditExportFrom.toISOString(),
    to: auditExportTo.toISOString(),
    ...(auditQuery ? { search: auditQuery } : {}),
    ...(auditEntity ? { status: auditEntity } : {}),
  });
  const nextAuditParams = new URLSearchParams();
  if (auditQuery) nextAuditParams.set("auditQuery", auditQuery);
  if (auditEntity) nextAuditParams.set("auditEntity", auditEntity);
  if (auditHistory.nextCursor) nextAuditParams.set("auditCursor", auditHistory.nextCursor);

  return (
    <AppShell currentPath="/settings" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader
          eyebrow="Rules and audit"
          title="Settings"
        />
        {canEditRules ? (
          <WorksheetShell
            eyebrow="Rule workspace"
            summary={<span>{rules.length} rules</span>}
            title="Rules"
          >
            <div className="p-3">
              <RuleConfigEditor rules={rules} />
            </div>
          </WorksheetShell>
        ) : (
          <WorksheetShell
            eyebrow="Worksheet"
            summary={<span>{rules.length} rules</span>}
            title="Rules"
          >
            <div className="worksheet-table-wrap hidden md:block">
              <table className="worksheet-table min-w-[760px]">
                <thead>
                  <tr>
                    {["Rule", "Category", "Value", "Blocks"].map((header) => (
                      <th key={header}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id}>
                      <td>
                        <p className="worksheet-cell-strong">{rule.label}</p>
                        <p className="worksheet-cell-muted mt-1">{rule.description}</p>
                      </td>
                      <td className="capitalize">{rule.category}</td>
                      <td className="worksheet-cell-mono max-w-[24rem]">{rule.displayValue}</td>
                      <td>{rule.criticalBlock ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="worksheet-mobile-list md:hidden">
              {rules.map((rule) => (
                <MobileWorksheetCard
                  key={rule.id}
                  meta={
                    <>
                      <span>{rule.category}</span>
                      <span>{rule.criticalBlock ? "Blocks" : "Advisory"}</span>
                    </>
                  }
                  title={rule.label}
                >
                  <dl className="contents">
                    <div className="mobile-worksheet-field mobile-worksheet-field-wide">
                      <dt className="mobile-worksheet-label">Value</dt>
                      <dd className="mobile-worksheet-value font-mono text-xs">{rule.displayValue}</dd>
                    </div>
                    <div className="mobile-worksheet-field mobile-worksheet-field-wide">
                      <dt className="mobile-worksheet-label">Description</dt>
                      <dd className="mobile-worksheet-value">{rule.description}</dd>
                    </div>
                  </dl>
                </MobileWorksheetCard>
              ))}
            </div>
          </WorksheetShell>
        )}
        <WorksheetShell
          eyebrow="Worksheet"
          summary={<span>{auditLogs.length} recent entries</span>}
          title="Operational history"
        >
          <form className="action-row border-b border-[var(--line)] bg-[var(--surface-2)] p-3" method="get">
            <Input aria-label="Search operational history" className="max-w-md" defaultValue={auditQuery} name="auditQuery" placeholder="Search action, actor, entity, lab, or request" />
            <Input aria-label="Filter by entity type" className="max-w-64" defaultValue={auditEntity} name="auditEntity" placeholder="Entity type" />
            <Button size="sm" type="submit">Filter</Button>
            {(auditQuery || auditEntity || auditCursor) ? <Link className="inline-flex h-11 items-center rounded-md px-3 text-sm font-semibold text-[var(--accent)] md:h-9" href="/settings">Clear</Link> : null}
            <Link className="inline-flex h-11 items-center rounded-md px-3 text-sm font-semibold text-[var(--accent)] md:h-9" href={`/api/exports/audit?${auditExportParams.toString()}`}>Export 30 days</Link>
          </form>
          {auditLogs.length ? (
            <>
              <div className="worksheet-table-wrap hidden md:block">
                <table className="worksheet-table min-w-[760px]">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Actor</th>
                      <th>Entity</th>
                      <th>Entity ID</th>
                      <th>Lab</th>
                      <th>Request</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="worksheet-cell-strong">{log.action}</td>
                        <td>{log.actor?.name ?? "System"}</td>
                        <td>{log.entityType}</td>
                        <td className="worksheet-cell-mono">{log.entityId}</td>
                        <td>{log.labCode ?? "Facility"}</td>
                        <td className="worksheet-cell-mono">{log.requestId ?? "-"}</td>
                        <td>{formatDate(log.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="worksheet-mobile-list md:hidden">
              {auditLogs.map((log) => (
                <MobileWorksheetCard
                  key={log.id}
                  meta={<span>{formatDate(log.timestamp)}</span>}
                  title={log.action}
                >
                  <dl className="contents">
                    <div className="mobile-worksheet-field">
                      <dt className="mobile-worksheet-label">Actor</dt>
                      <dd className="mobile-worksheet-value">{log.actor?.name ?? "System"}</dd>
                    </div>
                    <div className="mobile-worksheet-field">
                      <dt className="mobile-worksheet-label">Entity</dt>
                      <dd className="mobile-worksheet-value">{log.entityType}</dd>
                    </div>
                    <div className="mobile-worksheet-field mobile-worksheet-field-wide">
                      <dt className="mobile-worksheet-label">ID</dt>
                      <dd className="mobile-worksheet-value font-mono text-xs">{log.entityId}</dd>
                    </div>
                    <div className="mobile-worksheet-field">
                      <dt className="mobile-worksheet-label">Lab</dt>
                      <dd className="mobile-worksheet-value">{log.labCode ?? "Facility"}</dd>
                    </div>
                    <div className="mobile-worksheet-field mobile-worksheet-field-wide">
                      <dt className="mobile-worksheet-label">Request</dt>
                      <dd className="mobile-worksheet-value font-mono text-xs">{log.requestId ?? "-"}</dd>
                    </div>
                  </dl>
                </MobileWorksheetCard>
              ))}
              </div>
            </>
          ) : (
            <p className="px-4 py-5 text-sm text-[var(--muted)]">No audit entries are available.</p>
          )}
          {auditHistory.nextCursor ? <div className="action-row border-t border-[var(--line)] p-3"><Link className="inline-flex h-11 items-center rounded-md border border-[var(--line)] bg-white px-4 text-sm font-semibold text-[var(--ink)] md:h-9" href={`/settings?${nextAuditParams.toString()}`}>Next page</Link></div> : null}
        </WorksheetShell>
      </div>
    </AppShell>
  );
}
