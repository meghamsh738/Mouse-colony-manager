import Link from "next/link";

import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { MobileWorksheetCard, WorksheetShell } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/session";
import { getOutboxQueueView, getTechnicalConsoleView, type OutboxQueueStatus } from "@/lib/system-read";
import { formatDate, titleCase } from "@/lib/utils";

type SystemPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const timestampFormatter = new Intl.DateTimeFormat("en-IE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatTimestamp(value?: string | null) {
  return value ? `${timestampFormatter.format(new Date(value))} UTC` : "-";
}

function formatLag(seconds: number | null) {
  if (seconds === null) return "-";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function outboxBadgeVariant(status: OutboxQueueStatus | "processing" | "failed") {
  if (status === "delivered") return "success" as const;
  if (status === "dead_letter" || status === "failed") return "danger" as const;
  if (status === "leased" || status === "retry" || status === "processing") return "warning" as const;
  if (status === "pending") return "info" as const;
  return "neutral" as const;
}

export default async function SystemPage({ searchParams }: SystemPageProps) {
  const params = await searchParams;
  const securityQuery = first(params?.securityQuery)?.trim() ?? "";
  const severityParam = first(params?.severity);
  const outcomeParam = first(params?.outcome);
  const severity = severityParam === "info" || severityParam === "warning" || severityParam === "critical" ? severityParam : null;
  const outcome = outcomeParam === "succeeded" || outcomeParam === "denied" || outcomeParam === "failed" ? outcomeParam : null;
  const securityCursor = first(params?.securityCursor)?.trim() || null;
  const outboxQuery = first(params?.outboxQuery)?.trim() ?? "";
  const outboxStatusParam = first(params?.outboxStatus);
  const outboxStatus = (
    outboxStatusParam === "pending"
    || outboxStatusParam === "leased"
    || outboxStatusParam === "retry"
    || outboxStatusParam === "delivered"
    || outboxStatusParam === "dead_letter"
    || outboxStatusParam === "cancelled"
  ) ? outboxStatusParam : null;
  const outboxCursor = first(params?.outboxCursor)?.trim() || null;
  const user = await requireUser({ capability: "system:view" });
  const [view, outboxQueue] = await Promise.all([
    getTechnicalConsoleView(user, { cursor: securityCursor, query: securityQuery, severity, outcome }),
    getOutboxQueueView(user, { cursor: outboxCursor, query: outboxQuery, status: outboxStatus }),
  ]);
  const securityExportTo = new Date();
  const securityExportFrom = new Date(securityExportTo.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const securityExportParams = new URLSearchParams({
    from: securityExportFrom.toISOString(),
    to: securityExportTo.toISOString(),
    ...(securityQuery ? { search: securityQuery } : {}),
    ...(severity ? { status: severity } : {}),
    ...(outcome ? { outcome } : {}),
  });
  const nextSecurityParams = new URLSearchParams();
  if (securityQuery) nextSecurityParams.set("securityQuery", securityQuery);
  if (severity) nextSecurityParams.set("severity", severity);
  if (outcome) nextSecurityParams.set("outcome", outcome);
  if (outboxQuery) nextSecurityParams.set("outboxQuery", outboxQuery);
  if (outboxStatus) nextSecurityParams.set("outboxStatus", outboxStatus);
  if (outboxCursor) nextSecurityParams.set("outboxCursor", outboxCursor);
  if (view.securityNextCursor) nextSecurityParams.set("securityCursor", view.securityNextCursor);
  const nextOutboxParams = new URLSearchParams();
  if (securityQuery) nextOutboxParams.set("securityQuery", securityQuery);
  if (severity) nextOutboxParams.set("severity", severity);
  if (outcome) nextOutboxParams.set("outcome", outcome);
  if (securityCursor) nextOutboxParams.set("securityCursor", securityCursor);
  if (outboxQuery) nextOutboxParams.set("outboxQuery", outboxQuery);
  if (outboxStatus) nextOutboxParams.set("outboxStatus", outboxStatus);
  if (outboxQueue.nextCursor) nextOutboxParams.set("outboxCursor", outboxQueue.nextCursor);
  const clearSecurityParams = new URLSearchParams();
  if (outboxQuery) clearSecurityParams.set("outboxQuery", outboxQuery);
  if (outboxStatus) clearSecurityParams.set("outboxStatus", outboxStatus);
  if (outboxCursor) clearSecurityParams.set("outboxCursor", outboxCursor);
  const clearOutboxParams = new URLSearchParams();
  if (securityQuery) clearOutboxParams.set("securityQuery", securityQuery);
  if (severity) clearOutboxParams.set("severity", severity);
  if (outcome) clearOutboxParams.set("outcome", outcome);
  if (securityCursor) clearOutboxParams.set("securityCursor", securityCursor);
  const queuedJobs = view.outboxStatuses
    .filter((entry) => entry.status === "pending" || entry.status === "retry" || entry.status === "leased")
    .reduce((sum, entry) => sum + entry.count, 0);
  const failedJobs = view.outboxStatuses
    .filter((entry) => entry.status === "dead_letter")
    .reduce((sum, entry) => sum + entry.count, 0);

  const severityVariant = (severity: "info" | "warning" | "critical") =>
    severity === "critical" ? "danger" as const : severity === "warning" ? "warning" as const : "info" as const;

  return (
    <AppShell currentPath="/system" role={user.role} userName={user.name ?? user.email}>
      <div className="space-y-5">
        <PageHeader eyebrow="Technical" title="System" />
        <WorksheetShell
          eyebrow="Runtime"
          summary={<span>{failedJobs ? `${failedJobs} dead-letter job${failedJobs === 1 ? "" : "s"}` : "No dead-letter jobs"}</span>}
          title="Service status"
        >
          <div className="metadata-grid p-4">
            <div><span className="metadata-label">Queued jobs</span><strong>{queuedJobs}</strong></div>
            <div><span className="metadata-label">Dead letters</span><strong>{failedJobs}</strong></div>
            <div><span className="metadata-label">Migration runs</span><strong>{view.recentMigrations.length}</strong></div>
            <div><span className="metadata-label">Security events</span><strong>{view.securityEvents.length}</strong></div>
          </div>
        </WorksheetShell>

        <WorksheetShell
          eyebrow="IT only"
          summary={<span>{view.queueTopics.length} active queue topic{view.queueTopics.length === 1 ? "" : "s"}</span>}
          title="Queue health"
        >
          {view.queueTopics.length ? <div className="worksheet-table-wrap">
            <table className="worksheet-table min-w-[900px]">
              <thead><tr><th>Topic</th><th>Ready</th><th>Scheduled</th><th>Retry</th><th>Active leases</th><th>Expired leases</th><th>Dead letters</th><th>Oldest-ready lag</th></tr></thead>
              <tbody>{view.queueTopics.map((topic) => <tr key={topic.topic}>
                <td className="worksheet-cell-mono">{topic.topic}</td>
                <td>{topic.ready}</td><td>{topic.scheduled}</td><td>{topic.retry}</td><td>{topic.active}</td>
                <td>{topic.expired ? <Badge variant="warning">{topic.expired}</Badge> : 0}</td>
                <td>{topic.deadLetter ? <Badge variant="danger">{topic.deadLetter}</Badge> : 0}</td>
                <td>{formatLag(topic.oldestReadyLagSeconds)}<p className="worksheet-cell-muted">Since {formatTimestamp(topic.oldestReadyAt)}</p></td>
              </tr>)}</tbody>
            </table>
          </div> : <p className="px-4 py-5 text-sm text-[var(--muted)]">The outbox queue is empty.</p>}
          <div className="border-t border-[var(--line)] p-4">
            <h3 className="text-sm font-semibold text-[var(--ink)]">Recent worker runs</h3>
            {view.recentWorkerRuns.length ? <div className="mt-3 grid gap-2 md:grid-cols-2">{view.recentWorkerRuns.map((run) => <div className="rounded-md border border-[var(--line)] p-3" key={run.id}>
              <div className="flex flex-wrap items-center gap-2"><Badge variant={run.outcome === "succeeded" ? "success" : "warning"}>{titleCase(run.outcome)}</Badge><strong className="font-mono text-xs">{run.subjectId ?? "outbox_worker"}</strong></div>
              <p className="mt-2 text-sm text-[var(--muted)]">{run.summary}</p>
              <p className="worksheet-cell-muted mt-1">{formatTimestamp(run.occurredAt)}</p>
            </div>)}</div> : <p className="mt-2 text-sm text-[var(--muted)]">No worker run has been recorded yet.</p>}
          </div>
        </WorksheetShell>

        <WorksheetShell
          eyebrow="IT only"
          summary={<span>{outboxQueue.items.length} queue item{outboxQueue.items.length === 1 ? "" : "s"} on this page</span>}
          title="Outbox queue"
        >
          <form className="action-row border-b border-[var(--line)] bg-[var(--surface-2)] p-3" method="get">
            {securityQuery ? <input name="securityQuery" type="hidden" value={securityQuery} /> : null}
            {severity ? <input name="severity" type="hidden" value={severity} /> : null}
            {outcome ? <input name="outcome" type="hidden" value={outcome} /> : null}
            {securityCursor ? <input name="securityCursor" type="hidden" value={securityCursor} /> : null}
            <Input aria-label="Search outbox queue" className="max-w-md" defaultValue={outboxQuery} name="outboxQuery" placeholder="Search queue ID or topic" />
            <select aria-label="Filter outbox by status" className="h-11 rounded-md border border-[var(--line)] bg-white px-3 text-sm md:h-9" defaultValue={outboxStatus ?? ""} name="outboxStatus">
              <option value="">All statuses</option><option value="pending">Pending</option><option value="leased">Leased</option><option value="retry">Retry</option><option value="delivered">Delivered</option><option value="dead_letter">Dead letter</option><option value="cancelled">Cancelled</option>
            </select>
            <Button size="sm" type="submit">Filter</Button>
            {(outboxQuery || outboxStatus || outboxCursor) ? <Link className="inline-flex h-11 items-center rounded-md px-3 text-sm font-semibold text-[var(--accent)] md:h-9" href={clearOutboxParams.size ? `/system?${clearOutboxParams.toString()}` : "/system"}>Clear queue filters</Link> : null}
          </form>
          {outboxQueue.items.length ? <>
            <div className="worksheet-table-wrap hidden md:block">
              <table className="worksheet-table min-w-[1280px]">
                <thead><tr><th>Queue item</th><th>Status</th><th>Attempts</th><th>Availability</th><th>Lease</th><th>Recent attempts</th><th>Timestamps</th></tr></thead>
                <tbody>{outboxQueue.items.map((message) => <tr key={message.id}>
                  <td><strong className="wrap-value font-mono text-xs">{message.id}</strong><p className="worksheet-cell-muted mt-1 font-mono">{message.topic}</p></td>
                  <td><Badge variant={outboxBadgeVariant(message.status)}>{titleCase(message.status)}</Badge></td>
                  <td><strong>{message.attemptCount} / {message.maxAttempts}</strong><p className="worksheet-cell-muted">{message.attemptsRemaining} remaining</p></td>
                  <td>{titleCase(message.availability)}<p className="worksheet-cell-muted">Available {formatTimestamp(message.availableAt)}</p></td>
                  <td>{titleCase(message.leaseState)}<p className="worksheet-cell-muted">Expires {formatTimestamp(message.leaseExpiresAt)}</p></td>
                  <td>{message.attempts.length ? <div className="space-y-2">{message.attempts.map((attempt) => <div key={attempt.id}>
                    <div className="flex flex-wrap items-center gap-2"><Badge variant={outboxBadgeVariant(attempt.status)}>{titleCase(attempt.status)}</Badge><span className="font-mono text-xs">#{attempt.attemptNumber} · {attempt.id}</span></div>
                    <p className="worksheet-cell-muted font-mono">{attempt.workerType} · {attempt.workerId}</p>
                    <p className="worksheet-cell-muted">Authorized {formatTimestamp(attempt.authorizedAt)} · Started {formatTimestamp(attempt.startedAt)} · Completed {formatTimestamp(attempt.completedAt)}</p>
                  </div>)}</div> : <span className="worksheet-cell-muted">No attempts recorded</span>}</td>
                  <td><span className="whitespace-nowrap">Created {formatTimestamp(message.createdAt)}</span><p className="worksheet-cell-muted whitespace-nowrap">Updated {formatTimestamp(message.updatedAt)}</p><p className="worksheet-cell-muted whitespace-nowrap">Leased {formatTimestamp(message.leasedAt)}</p><p className="worksheet-cell-muted whitespace-nowrap">Delivered {formatTimestamp(message.deliveredAt)}</p><p className="worksheet-cell-muted whitespace-nowrap">Dead-lettered {formatTimestamp(message.deadLetteredAt)}</p></td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="worksheet-mobile-list md:hidden">{outboxQueue.items.map((message) => <MobileWorksheetCard
              key={message.id}
              meta={<><Badge variant={outboxBadgeVariant(message.status)}>{titleCase(message.status)}</Badge><span>{message.attemptCount} / {message.maxAttempts} attempts</span></>}
              title={<span className="font-mono text-sm">{message.id}</span>}
            >
              <dl className="contents">
                <div className="mobile-worksheet-field mobile-worksheet-field-wide"><dt className="mobile-worksheet-label">Topic</dt><dd className="mobile-worksheet-value font-mono text-xs">{message.topic}</dd></div>
                <div className="mobile-worksheet-field"><dt className="mobile-worksheet-label">Availability</dt><dd className="mobile-worksheet-value">{titleCase(message.availability)}</dd></div>
                <div className="mobile-worksheet-field"><dt className="mobile-worksheet-label">Attempts remaining</dt><dd className="mobile-worksheet-value">{message.attemptsRemaining}</dd></div>
                <div className="mobile-worksheet-field"><dt className="mobile-worksheet-label">Lease</dt><dd className="mobile-worksheet-value">{titleCase(message.leaseState)}</dd></div>
                <div className="mobile-worksheet-field"><dt className="mobile-worksheet-label">Lease expiry</dt><dd className="mobile-worksheet-value">{formatTimestamp(message.leaseExpiresAt)}</dd></div>
                <div className="mobile-worksheet-field mobile-worksheet-field-wide"><dt className="mobile-worksheet-label">Timestamps</dt><dd className="mobile-worksheet-value text-xs">Created {formatTimestamp(message.createdAt)}<br />Updated {formatTimestamp(message.updatedAt)}<br />Available {formatTimestamp(message.availableAt)}<br />Leased {formatTimestamp(message.leasedAt)}<br />Delivered {formatTimestamp(message.deliveredAt)}<br />Dead-lettered {formatTimestamp(message.deadLetteredAt)}</dd></div>
                <div className="mobile-worksheet-field mobile-worksheet-field-wide"><dt className="mobile-worksheet-label">Recent attempts</dt><dd className="mobile-worksheet-value">{message.attempts.length ? <div className="space-y-2">{message.attempts.map((attempt) => <div key={attempt.id}><div className="flex flex-wrap items-center gap-2"><Badge variant={outboxBadgeVariant(attempt.status)}>{titleCase(attempt.status)}</Badge><span className="font-mono text-xs">#{attempt.attemptNumber} · {attempt.id}</span></div><p className="mt-1 font-mono text-xs text-[var(--muted)]">{attempt.workerType} · {attempt.workerId}<br />Authorized {formatTimestamp(attempt.authorizedAt)}<br />Started {formatTimestamp(attempt.startedAt)} · Completed {formatTimestamp(attempt.completedAt)}</p></div>)}</div> : "No attempts recorded"}</dd></div>
              </dl>
            </MobileWorksheetCard>)}</div>
          </> : <p className="px-4 py-5 text-sm text-[var(--muted)]">No outbox queue items match these filters.</p>}
          {outboxQueue.nextCursor ? <div className="action-row border-t border-[var(--line)] p-3"><Link className="inline-flex h-11 items-center rounded-md border border-[var(--line)] bg-white px-4 text-sm font-semibold text-[var(--ink)] md:h-9" href={`/system?${nextOutboxParams.toString()}`}>Next queue page</Link></div> : null}
        </WorksheetShell>

        <WorksheetShell
          eyebrow="IT only"
          summary={<span>{view.securityEvents.length} recent events</span>}
          title="Security events"
        >
          <form className="action-row border-b border-[var(--line)] bg-[var(--surface-2)] p-3" method="get">
            {outboxQuery ? <input name="outboxQuery" type="hidden" value={outboxQuery} /> : null}
            {outboxStatus ? <input name="outboxStatus" type="hidden" value={outboxStatus} /> : null}
            {outboxCursor ? <input name="outboxCursor" type="hidden" value={outboxCursor} /> : null}
            <Input aria-label="Search security events" className="max-w-md" defaultValue={securityQuery} name="securityQuery" placeholder="Search event, actor, subject, reported scope, or correlation" />
            <select aria-label="Filter by severity" className="h-11 rounded-md border border-[var(--line)] bg-white px-3 text-sm md:h-9" defaultValue={severity ?? ""} name="severity">
              <option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option>
            </select>
            <select aria-label="Filter by outcome" className="h-11 rounded-md border border-[var(--line)] bg-white px-3 text-sm md:h-9" defaultValue={outcome ?? ""} name="outcome">
              <option value="">All outcomes</option><option value="failed">Failed</option><option value="denied">Denied</option><option value="succeeded">Succeeded</option>
            </select>
            <Button size="sm" type="submit">Filter</Button>
            {(securityQuery || severity || outcome || securityCursor) ? <Link className="inline-flex h-11 items-center rounded-md px-3 text-sm font-semibold text-[var(--accent)] md:h-9" href={clearSecurityParams.size ? `/system?${clearSecurityParams.toString()}` : "/system"}>Clear security filters</Link> : null}
            <Link className="inline-flex h-11 items-center rounded-md px-3 text-sm font-semibold text-[var(--accent)] md:h-9" href={`/api/exports/security?${securityExportParams.toString()}`}>Export 30 days</Link>
          </form>
          {view.securityEvents.length ? <>
            <div className="worksheet-table-wrap hidden md:block">
              <table className="worksheet-table min-w-[980px]">
                <thead><tr><th>Event</th><th>Outcome</th><th>Actor</th><th>Subject</th><th>Reported scope</th><th>Reported correlation</th><th>Date</th></tr></thead>
                <tbody>{view.securityEvents.map((event) => <tr key={event.id}>
                  <td><div className="flex flex-wrap items-center gap-2"><Badge variant={severityVariant(event.severity)}>{event.severity}</Badge><strong className="wrap-value">{event.summary}</strong></div><p className="worksheet-cell-muted mt-1">{event.eventType} · {event.source}</p></td>
                  <td>{titleCase(event.outcome)}</td>
                  <td>{event.actor?.name ?? "System"}<p className="worksheet-cell-muted">{titleCase(event.actorRole)}</p></td>
                  <td className="worksheet-cell-mono">{event.subjectType && event.subjectId ? `${event.subjectType}: ${event.subjectId}` : "-"}</td>
                  <td>{event.scopeLab?.code ?? "Facility"}</td>
                  <td className="worksheet-cell-mono">{event.correlationId ?? "-"}</td>
                  <td>{formatDate(event.occurredAt)}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="worksheet-mobile-list md:hidden">{view.securityEvents.map((event) => <MobileWorksheetCard
              key={event.id}
              meta={<><Badge variant={severityVariant(event.severity)}>{event.severity}</Badge><span>{formatDate(event.occurredAt)}</span></>}
              title={event.summary}
            >
              <dl className="contents">
                <div className="mobile-worksheet-field"><dt className="mobile-worksheet-label">Outcome</dt><dd className="mobile-worksheet-value">{titleCase(event.outcome)}</dd></div>
                <div className="mobile-worksheet-field"><dt className="mobile-worksheet-label">Actor</dt><dd className="mobile-worksheet-value">{event.actor?.name ?? "System"}</dd></div>
                <div className="mobile-worksheet-field"><dt className="mobile-worksheet-label">Actor role</dt><dd className="mobile-worksheet-value">{titleCase(event.actorRole)}</dd></div>
                <div className="mobile-worksheet-field"><dt className="mobile-worksheet-label">Reported scope</dt><dd className="mobile-worksheet-value">{event.scopeLab?.code ?? "Facility"}</dd></div>
                <div className="mobile-worksheet-field mobile-worksheet-field-wide"><dt className="mobile-worksheet-label">Event</dt><dd className="mobile-worksheet-value font-mono text-xs">{event.eventType}</dd></div>
                <div className="mobile-worksheet-field mobile-worksheet-field-wide"><dt className="mobile-worksheet-label">Subject</dt><dd className="mobile-worksheet-value font-mono text-xs">{event.subjectType && event.subjectId ? `${event.subjectType}: ${event.subjectId}` : "-"}</dd></div>
                <div className="mobile-worksheet-field mobile-worksheet-field-wide"><dt className="mobile-worksheet-label">Correlation</dt><dd className="mobile-worksheet-value wrap-value font-mono text-xs">{event.correlationId ?? "-"}</dd></div>
              </dl>
            </MobileWorksheetCard>)}</div>
          </> : <p className="px-4 py-5 text-sm text-[var(--muted)]">No security events are available.</p>}
          {view.securityNextCursor ? <div className="action-row border-t border-[var(--line)] p-3"><Link className="inline-flex h-11 items-center rounded-md border border-[var(--line)] bg-white px-4 text-sm font-semibold text-[var(--ink)] md:h-9" href={`/system?${nextSecurityParams.toString()}`}>Next page</Link></div> : null}
        </WorksheetShell>

        <WorksheetShell eyebrow="Deployment" summary={<span>{view.recentMigrations.length} recent runs</span>} title="Migration activity">
          {view.recentMigrations.length ? <><div className="worksheet-table-wrap hidden md:block"><table className="worksheet-table min-w-[680px]"><thead><tr><th>Type</th><th>Status</th><th>Started</th><th>Completed</th></tr></thead><tbody>{view.recentMigrations.map((migration) => <tr key={migration.id}><td className="worksheet-cell-strong">{migration.migrationType}</td><td>{titleCase(migration.status)}</td><td>{formatDate(migration.startedAt ?? migration.createdAt)}</td><td>{migration.completedAt ? formatDate(migration.completedAt) : "-"}</td></tr>)}</tbody></table></div><div className="worksheet-mobile-list md:hidden">{view.recentMigrations.map((migration) => <MobileWorksheetCard
            key={migration.id}
            meta={<Badge variant={migration.status === "succeeded" ? "success" : migration.status === "running" ? "warning" : "info"}>{titleCase(migration.status)}</Badge>}
            title={migration.migrationType}
          >
            <div className="mobile-worksheet-field"><span className="mobile-worksheet-label">Started</span><span className="mobile-worksheet-value">{formatDate(migration.startedAt ?? migration.createdAt)}</span></div>
            <div className="mobile-worksheet-field"><span className="mobile-worksheet-label">Completed</span><span className="mobile-worksheet-value">{migration.completedAt ? formatDate(migration.completedAt) : "-"}</span></div>
          </MobileWorksheetCard>)}</div></> : <p className="px-4 py-5 text-sm text-[var(--muted)]">No migration runs are recorded.</p>}
        </WorksheetShell>
      </div>
    </AppShell>
  );
}
