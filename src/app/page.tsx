import Link from "next/link";
import { ArrowRight, Stethoscope } from "lucide-react";
import { redirect } from "next/navigation";

import { AlertFeed } from "@/components/app/alert-feed";
import { AppShell } from "@/components/app/app-shell";
import { PersonaDashboard } from "@/components/app/persona-dashboard";
import { StatStrip } from "@/components/app/stat-strip";
import { Badge } from "@/components/ui/badge";
import { actorHasCapability } from "@/lib/capabilities";
import {
  getBreedingSuggestionSummaryView,
  getDashboardOverviewView,
} from "@/lib/dashboard-read";
import { getPersonaDashboardView, type PersonaQueueItem } from "@/lib/persona-dashboard-read";
import { requireUser } from "@/lib/session";
import type { Alert } from "@/lib/types";
import { formatDate } from "@/lib/utils";

function getAlertHref(alert: Alert) {
  if (alert.entityType === "animal") {
    return `/animals/${alert.entityId}`;
  }

  if (alert.entityType === "cage") {
    return `/cages/${alert.entityId}`;
  }

  if (alert.entityType === "experiment") {
    return "/experiments";
  }

  if (alert.entityType === "litter") {
    return "/breeding";
  }

  return "/notifications";
}

function severityVariant(severity: Alert["severity"]) {
  if (severity === "critical") {
    return "danger";
  }

  if (severity === "warning") {
    return "warning";
  }

  return "info";
}

export default async function DashboardPage() {
  const user = await requireUser({ capability: "dashboard:view" });
  if (user.canonicalRole === "it_head") {
    redirect("/system");
  }
  const [{ metrics, composition, highlights }, persona, suggestions] = await Promise.all([
    getDashboardOverviewView(user),
    getPersonaDashboardView(user),
    user.canonicalRole === "lab_user"
      ? getBreedingSuggestionSummaryView(user).catch((error) => {
          console.error("[dashboard] breeding suggestions unavailable", error);
          return [];
        })
      : Promise.resolve([]),
  ]);
  const welfareQueue: PersonaQueueItem = {
    id: "welfare",
    label: "Welfare follow-ups",
    count: highlights.staffFollowups.length,
    href: "/notifications",
    tone: highlights.staffFollowups.length ? "danger" : "neutral",
  };
  const alertQueue: PersonaQueueItem = {
    id: "alerts",
    label: "Open alerts",
    count: metrics.openAlerts,
    href: "/notifications",
    tone: metrics.openAlerts ? "warning" : "neutral",
  };
  const weaningQueue: PersonaQueueItem = {
    id: "weaning",
    label: "Litters to wean",
    count: highlights.upcomingWean.length,
    href: "/breeding",
    tone: highlights.upcomingWean.length ? "warning" : "neutral",
  };
  const orderedQueue = user.canonicalRole === "facility_admin"
    ? [...persona.queue, welfareQueue, alertQueue]
    : user.canonicalRole === "cmu_staff"
      ? [welfareQueue, ...persona.queue, weaningQueue, alertQueue]
      : [welfareQueue, weaningQueue, ...persona.queue, alertQueue];

  return (
    <AppShell currentPath="/" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="dashboard-workspace">
        <PersonaDashboard
          activeLabName={user.activeMembership?.labName}
          canManageColony={actorHasCapability(user, "cages:manage")}
          onboarding={persona.onboarding}
          queue={orderedQueue}
          role={user.canonicalRole}
        />

        {user.canonicalRole !== "facility_admin" ? <section className="dashboard-lane" data-testid="dashboard-staff-followups">
          <div className="dashboard-lane-header">
            <div className="flex min-w-0 items-center gap-2">
              <Stethoscope className="h-4 w-4 text-[var(--danger)]" aria-hidden="true" />
              <h2>Staff / Vet follow-ups</h2>
              <span className="lane-count">{highlights.staffFollowups.length}</span>
            </div>
            <Link href="/notifications">View inbox</Link>
          </div>
          <div className="dashboard-row-list">
            {highlights.staffFollowups.length ? (
              highlights.staffFollowups.map((alert) => (
                <Link
                  className="dashboard-followup-row"
                  data-severity={alert.severity}
                  href={getAlertHref(alert)}
                  key={alert.id}
                >
                  <span className="dashboard-row-priority" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="dashboard-row-title">{alert.message}</p>
                    <p className="dashboard-row-meta">
                      {alert.entityType} · {formatDate(alert.generatedAt)}
                    </p>
                  </div>
                  <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
                  <ArrowRight className="h-4 w-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                </Link>
              ))
            ) : (
              <p className="dashboard-empty-row">No health or welfare follow-ups.</p>
            )}
          </div>
        </section> : null}

        <StatStrip
          stats={[
            { label: "Active mice", value: metrics.activeAnimals, emphasis: "success" },
            { label: "Open alerts", value: metrics.openAlerts, emphasis: "danger" },
            { label: "Experiment-ready", value: metrics.availableForExperiment, emphasis: "info" },
            { label: "Pending genotype", value: metrics.pendingGenotypes, emphasis: "warning" },
            { label: "Active breeders", value: metrics.activeBreeders, emphasis: "success" },
            { label: "Old breeders", value: metrics.oldBreeders, emphasis: "warning" },
          ]}
        />

        <AlertFeed alerts={highlights.alerts} title="Priority alerts" />

        {user.canonicalRole !== "facility_admin" ? <section className="dashboard-lane">
          <div className="dashboard-lane-header">
            <div className="flex min-w-0 items-center gap-2">
              <h2>Upcoming litter work</h2>
              <span className="lane-count">{highlights.upcomingWean.length}</span>
            </div>
            <Link href="/breeding">Open breeding</Link>
          </div>
          <div className="dashboard-row-list">
            {highlights.upcomingWean.length ? (
              highlights.upcomingWean.map((item) => (
                <Link className="dashboard-data-row" href="/breeding" key={item.litterId}>
                  <span className="dashboard-row-id">{item.litterId}</span>
                  <span className="dashboard-row-value">Due {item.dueDate}</span>
                  <span className="dashboard-row-meta">Breeding {item.breedingId}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                </Link>
              ))
            ) : (
              <p className="dashboard-empty-row">No upcoming weaning work.</p>
            )}
          </div>
        </section> : null}

        {user.canonicalRole === "lab_user" ? <section className="dashboard-lane">
          <div className="dashboard-lane-header">
            <div className="flex min-w-0 items-center gap-2">
              <h2>Suggested crosses</h2>
              <span className="lane-count">{suggestions.length}</span>
            </div>
            <Link href="/breeding">Open planner</Link>
          </div>
          <div className="dashboard-row-list">
            {suggestions.length ? (
              suggestions.slice(0, 4).map((suggestion) => (
                <Link className="dashboard-cross-row" href="/breeding" key={suggestion.id}>
                  <div className="min-w-0">
                    <p className="dashboard-row-title">{suggestion.sireLabel} × {suggestion.damLabel}</p>
                    <p className="dashboard-row-meta">
                      Expected usable pups {suggestion.expectedUsablePups} · {suggestion.expectedSexSplit}
                    </p>
                  </div>
                  <span className="dashboard-probability">{suggestion.probabilityLabel}</span>
                  <span className="dashboard-warning-text">{suggestion.warnings[0] ?? "No immediate warning"}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                </Link>
              ))
            ) : (
              <p className="dashboard-empty-row">Add breeding animals to generate cross suggestions.</p>
            )}
          </div>
        </section> : null}

        {user.canonicalRole === "lab_user" ? <section className="dashboard-composition" aria-label="Colony composition">
          <div>
            <span>{composition.males}</span>
            <p>Male</p>
          </div>
          <div>
            <span>{composition.females}</span>
            <p>Female</p>
          </div>
          <div>
            <span>{composition.breeding}</span>
            <p>In breeding</p>
          </div>
          <div>
            <span>{composition.transgenic}</span>
            <p>Transgenic</p>
          </div>
          <Link href="/forecast">Open colony forecast <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </section> : null}
      </div>
    </AppShell>
  );
}
