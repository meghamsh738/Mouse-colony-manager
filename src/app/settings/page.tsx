import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { Surface } from "@/components/app/surface";
import { requireUser } from "@/lib/session";
import { getRecentAuditLogsView, getRuleSummaryView } from "@/lib/settings-read";
import { formatDate } from "@/lib/utils";

export default async function SettingsPage() {
  const user = await requireUser();
  const [rules, auditLogs] = await Promise.all([getRuleSummaryView(), getRecentAuditLogsView()]);

  return (
    <AppShell currentPath="/settings" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Rules and audit"
          title="Admin-editable thresholds and recent changes."
          description="The MVP keeps breeding, welfare, experiment, and compliance thresholds in data rather than source code. This page shows the current configuration and the latest audit trail entries."
        />
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Surface className="overflow-x-auto p-0">
            <table className="min-w-full border-collapse">
              <thead className="bg-[var(--surface-2)] text-left text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                <tr>
                  {["Rule", "Category", "Value", "Blocks"].map((header) => (
                    <th key={header} className="px-5 py-4 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)] bg-white/70">
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td className="px-5 py-4">
                      <p className="font-medium">{rule.label}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">{rule.description}</p>
                    </td>
                    <td className="px-5 py-4 capitalize">{rule.category}</td>
                    <td className="px-5 py-4 font-mono text-sm">{rule.displayValue}</td>
                    <td className="px-5 py-4">{rule.criticalBlock ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>
          <Surface className="space-y-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Recent audit log</p>
            <div className="space-y-3">
              {auditLogs.map((log) => (
                <article key={log.id} className="rounded-2xl border border-[var(--line)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{log.action}</p>
                    <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">{formatDate(log.timestamp)}</p>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {log.actor?.name ?? "System"} updated {log.entityType} {log.entityId}
                  </p>
                </article>
              ))}
            </div>
          </Surface>
        </div>
      </div>
    </AppShell>
  );
}
