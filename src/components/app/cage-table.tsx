"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { RowActionMenu } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  INITIAL_VISIBLE_RECORDS,
  VISIBLE_RECORD_BATCH,
  VisibleRecordControls,
} from "@/components/app/visible-record-controls";
import type { CageListItem } from "@/lib/types";

function statusVariant(status: CageListItem["status"]) {
  if (status === "quarantine") {
    return "danger";
  }

  if (status === "breeding" || status === "experiment") {
    return "warning";
  }

  return "neutral";
}

function formatDailyRate(cage: CageListItem) {
  if (cage.dailyRateCents === null || cage.dailyRateCents === undefined) {
    return "No rate";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: cage.currencyCode ?? "USD",
  }).format(cage.dailyRateCents / 100);
}

function formatBillingCutoff(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function ValueChips({ emptyLabel = "None", values }: { emptyLabel?: string; values: string[] }) {
  if (!values.length) {
    return <span className="text-sm text-[var(--muted)]">{emptyLabel}</span>;
  }

  return (
    <div className="chip-list">
      {values.map((value) => (
        <span className="value-chip" key={value}>
          {value}
        </span>
      ))}
    </div>
  );
}

function CapacitySummary({ cage }: { cage: CageListItem }) {
  const overLimit = Math.max(0, cage.occupantCount - cage.capacity);
  const atLimit = cage.occupantCount === cage.capacity;

  return (
    <div className={overLimit ? "capacity-summary is-over" : atLimit ? "capacity-summary is-full" : "capacity-summary"}>
      <p className="font-semibold tabular-nums">{cage.occupantCount} / {cage.capacity}</p>
      <p className="capacity-summary-label">
        {overLimit
          ? `${overLimit} over limit`
          : cage.remainingCapacity === 1
            ? "1 space"
            : `${cage.remainingCapacity} spaces`}
      </p>
    </div>
  );
}

function WarningSummary({ cage }: { cage: CageListItem }) {
  if (!cage.warningCount) {
    return <span className="text-sm text-[var(--muted)]">None</span>;
  }

  return (
    <div className="warning-summary">
      <AlertTriangle aria-hidden="true" size={15} />
      <div className="min-w-0">
        <p className="wrap-value font-semibold">{cage.warningMessages[0] ?? `${cage.warningCount} warnings`}</p>
        {cage.warningCount > 1 ? <p className="text-xs">+{cage.warningCount - 1} more</p> : null}
      </div>
    </div>
  );
}

export function CageTable({ data }: { data: CageListItem[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CageListItem["status"]>("all");
  const [labFilter, setLabFilter] = useState("all");
  const [chargeCategoryFilter, setChargeCategoryFilter] = useState("all");
  const [chargeStateFilter, setChargeStateFilter] = useState<"all" | CageListItem["chargeState"]>("all");
  const [occupancyFilter, setOccupancyFilter] = useState<"all" | "occupied" | "empty">("all");
  const [sexFilter, setSexFilter] = useState<"all" | "male" | "female" | "mixed" | "unknown">("all");
  const [warningsOnly, setWarningsOnly] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const labOptions = useMemo(
    () =>
      Array.from(
        new Map(
          data
            .filter((cage) => cage.labId && cage.labName)
            .map((cage) => [cage.labId, { id: cage.labId ?? "", label: cage.labName ?? "Unassigned lab" }]),
        ).values(),
      ).sort((left, right) => left.label.localeCompare(right.label)),
    [data],
  );
  const chargeCategoryOptions = useMemo(
    () =>
      Array.from(
        new Map(
          data
            .filter((cage) => cage.chargeCategoryId && cage.chargeCategoryName)
            .map((cage) => [
              cage.chargeCategoryId,
              { id: cage.chargeCategoryId ?? "", label: cage.chargeCategoryName ?? "Unpriced" },
            ]),
        ).values(),
      ).sort((left, right) => left.label.localeCompare(right.label)),
    [data],
  );
  const visibleCountKey = useMemo(
    () =>
      JSON.stringify([
        data.length,
        deferredSearch,
        statusFilter,
        labFilter,
        chargeCategoryFilter,
        chargeStateFilter,
        occupancyFilter,
        sexFilter,
        warningsOnly,
      ]),
    [
      data.length,
      deferredSearch,
      statusFilter,
      labFilter,
      chargeCategoryFilter,
      chargeStateFilter,
      occupancyFilter,
      sexFilter,
      warningsOnly,
    ],
  );
  const [visibleRecordState, setVisibleRecordState] = useState({
    count: INITIAL_VISIBLE_RECORDS,
    key: visibleCountKey,
  });
  const visibleCount =
    visibleRecordState.key === visibleCountKey ? visibleRecordState.count : INITIAL_VISIBLE_RECORDS;
  const setVisibleCount = (nextCount: number | ((currentCount: number) => number)) => {
    setVisibleRecordState((currentState) => {
      const currentCount =
        currentState.key === visibleCountKey ? currentState.count : INITIAL_VISIBLE_RECORDS;
      const count = typeof nextCount === "function" ? nextCount(currentCount) : nextCount;

      return { count, key: visibleCountKey };
    });
  };

  const filteredData = useMemo(
    () =>
      data.filter((cage) => {
        const haystack = [
          cage.roomNumber,
          cage.rackNumber,
          cage.cageNumber,
          cage.barcode,
          cage.labName ?? "",
          cage.labCode ?? "",
          cage.animalIdentifiers.join(" "),
          cage.animalLabIdentifiers.join(" "),
          cage.sexComposition,
          cage.strainSummary,
          cage.projectSummary,
          cage.chargeCategoryName ?? "",
          cage.chargeState,
        ]
          .join(" ")
          .toLowerCase();
        const matchesSearch = haystack.includes(deferredSearch.toLowerCase());
        const matchesStatus = statusFilter === "all" ? true : cage.status === statusFilter;
        const matchesLab = labFilter === "all" ? true : cage.labId === labFilter;
        const matchesChargeCategory =
          chargeCategoryFilter === "all" ? true : cage.chargeCategoryId === chargeCategoryFilter;
        const matchesChargeState = chargeStateFilter === "all" ? true : cage.chargeState === chargeStateFilter;
        const matchesOccupancy =
          occupancyFilter === "all"
            ? true
            : occupancyFilter === "occupied"
              ? cage.occupantCount > 0
              : cage.occupantCount === 0;
        const sexComposition = cage.sexComposition.toLowerCase();
        const matchesSex =
          sexFilter === "all"
            ? true
            : sexFilter === "mixed"
              ? sexComposition.includes("m") && sexComposition.includes("f")
              : sexComposition.includes(sexFilter === "male" ? "m" : sexFilter === "female" ? "f" : "u");
        const matchesWarnings = warningsOnly ? cage.warningCount > 0 : true;

        return (
          matchesSearch &&
          matchesStatus &&
          matchesLab &&
          matchesChargeCategory &&
          matchesChargeState &&
          matchesOccupancy &&
          matchesSex &&
          matchesWarnings
        );
      }),
    [
      data,
      deferredSearch,
      statusFilter,
      labFilter,
      chargeCategoryFilter,
      chargeStateFilter,
      occupancyFilter,
      sexFilter,
      warningsOnly,
    ],
  );

  const visibleData = useMemo(() => filteredData.slice(0, visibleCount), [filteredData, visibleCount]);
  const currentViewExportHref = useMemo(() => {
    const params = new URLSearchParams();

    if (search.trim()) {
      params.set("search", search.trim());
    }

    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }

    if (warningsOnly) {
      params.set("warningsOnly", "true");
    }

    const query = params.toString();

    return `/api/exports/cages${query ? `?${query}` : ""}`;
  }, [search, statusFilter, warningsOnly]);

  const currentViewPrintHref = useMemo(() => {
    const params = new URLSearchParams();

    if (search.trim()) {
      params.set("search", search.trim());
    }

    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }

    if (warningsOnly) {
      params.set("warningsOnly", "true");
    }

    const query = params.toString();

    return `/cages/labels${query ? `?${query}` : ""}`;
  }, [search, statusFilter, warningsOnly]);

  return (
    <div className="space-y-4" data-testid="cage-table">
      <div className="space-y-2.5">
        <div className="filter-toolbar">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search cage, animal, lab, strain, project"
            data-testid="cage-search"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="breeding">Breeding</option>
            <option value="experiment">Experiment</option>
            <option value="quarantine">Quarantine</option>
            <option value="retired">Retired</option>
            <option value="closed">Closed</option>
          </select>
          <label className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--muted)]">
            <input checked={warningsOnly} onChange={(event) => setWarningsOnly(event.target.checked)} type="checkbox" />
            <span className="truncate">Warnings only</span>
          </label>
        </div>
        <details className="group rounded-lg border border-[var(--line)] bg-white/42">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-medium text-[var(--muted)] [&::-webkit-details-marker]:hidden">
            Advanced filters
            <span className="group-open:hidden">+</span>
            <span className="hidden group-open:inline">-</span>
          </summary>
          <div className="grid min-w-0 gap-3 border-t border-[var(--line)] p-3 sm:grid-cols-2 lg:grid-cols-5">
            <select
              value={labFilter}
              onChange={(event) => setLabFilter(event.target.value)}
              className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
            >
              <option value="all">All labs</option>
              {labOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={chargeCategoryFilter}
              onChange={(event) => setChargeCategoryFilter(event.target.value)}
              className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
            >
              <option value="all">All rates</option>
              {chargeCategoryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={chargeStateFilter}
              onChange={(event) => setChargeStateFilter(event.target.value as typeof chargeStateFilter)}
              className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
            >
              <option value="all">All charge states</option>
              <option value="chargeable">Chargeable</option>
              <option value="unpriced">Unpriced</option>
              <option value="exited">Exited</option>
            </select>
            <select
              value={occupancyFilter}
              onChange={(event) => setOccupancyFilter(event.target.value as typeof occupancyFilter)}
              className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
            >
              <option value="all">All occupancy</option>
              <option value="occupied">Occupied</option>
              <option value="empty">Empty</option>
            </select>
            <select
              value={sexFilter}
              onChange={(event) => setSexFilter(event.target.value as typeof sexFilter)}
              className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
            >
              <option value="all">All sex mix</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="mixed">Mixed</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
        </details>
        <div className="utility-bar">
          <p className="text-sm text-[var(--muted)]">
            Showing <span className="font-medium text-[var(--ink)]">{visibleData.length}</span> of{" "}
            <span className="font-medium text-[var(--ink)]">{filteredData.length}</span> matching cages
            {filteredData.length === data.length ? "" : (
              <>
                {" "}
                from <span className="font-medium text-[var(--ink)]">{data.length}</span> total cages
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={currentViewPrintHref}
              prefetch={false}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)] md:h-9"
              data-testid="cage-print-current"
            >
              Print cage labels
            </Link>
            <details className="relative">
              <summary className="inline-flex h-11 cursor-pointer list-none items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] md:h-9 [&::-webkit-details-marker]:hidden">
                Export
              </summary>
              <div className="absolute right-0 z-20 mt-2 grid min-w-40 gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 shadow-lg">
                <Link className="table-action justify-start" href={currentViewExportHref} prefetch={false} data-testid="cage-export-current">
                  Filtered
                </Link>
                <Link className="table-action justify-start" href="/api/exports/cages" prefetch={false} data-testid="cage-export-all">
                  All cages
                </Link>
              </div>
            </details>
          </div>
        </div>
      </div>
      <VisibleRecordControls
        matchingCount={filteredData.length}
        noun="cages"
        onShowAll={() => setVisibleCount(filteredData.length)}
        onShowMore={() =>
          setVisibleCount((current) => Math.min(current + VISIBLE_RECORD_BATCH, filteredData.length))
        }
        totalCount={data.length}
        visibleCount={visibleData.length}
      />
      <div className="data-table-wrap hidden md:block">
        <table className="data-table compact-table min-w-[960px]">
          <thead>
            <tr>
              {["Cage", "Lab", "Status", "Occupants", "Strain", "Warnings", "Charge", "Actions"].map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleData.map((cage) => (
              <tr
                className={cage.warningCount ? "triage-row-warning" : undefined}
                key={cage.id}
                data-testid="cage-row"
              >
                <td className="min-w-[10rem]">
                  <Link className="wrap-value font-semibold hover:text-[var(--accent)]" href={`/cages/${cage.id}`}>
                    {cage.roomNumber} / {cage.rackNumber} / {cage.cageNumber}
                  </Link>
                  <p
                    className="mt-1 wrap-value font-mono text-xs uppercase tracking-[0.08em] text-[var(--muted)]"
                    data-testid="cage-row-barcode"
                  >
                    {cage.barcode}
                  </p>
                </td>
                <td className="wrap-value text-sm" data-testid="cage-row-lab">
                  {cage.labName ?? cage.labCode ?? "Unassigned"}
                </td>
                <td>
                  <Badge variant={statusVariant(cage.status)}>{cage.status}</Badge>
                </td>
                <td className="min-w-[10rem]">
                  <CapacitySummary cage={cage} />
                  <div className="mt-1 max-w-[18rem]">
                    <ValueChips emptyLabel="Empty" values={cage.animalIdentifiers.slice(0, 4)} />
                  </div>
                  {cage.animalIdentifiers.length > 4 ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">+{cage.animalIdentifiers.length - 4} more</p>
                  ) : null}
                </td>
                <td className="wrap-value max-w-[18rem] text-sm text-[var(--muted-strong)]">{cage.strainSummary}</td>
                <td>
                  <WarningSummary cage={cage} />
                </td>
                <td className="wrap-value min-w-[9rem] text-sm">
                  <p className="font-medium">{cage.chargeCategoryName ?? cage.chargeState}</p>
                  <p className="text-[var(--muted)]">
                    {cage.billingCutoffAt ? `Ended ${formatBillingCutoff(cage.billingCutoffAt)}` : `${formatDailyRate(cage)}/day`}
                  </p>
                </td>
                <td>
                  <div className="action-row">
                    <Link aria-label={`Scan cage ${cage.barcode}`} className="table-action table-action-primary" href={`/scan/${cage.barcode}`}>
                      Scan
                    </Link>
                    <RowActionMenu label="More">
                      <Link className="table-action justify-start" href={`/cages/labels?cageId=${cage.id}`}>
                        Print cage label
                      </Link>
                      <Link className="table-action justify-start" href={`/billing?cageId=${cage.id}`}>
                        Billing history
                      </Link>
                    </RowActionMenu>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden">
        <div className="row-list">
          {visibleData.map((cage) => (
            <article
              key={cage.id}
              className={`record-row ${cage.warningCount ? "record-row-warning" : ""}`}
              data-testid="cage-row"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link className="wrap-value font-semibold hover:text-[var(--accent)]" href={`/cages/${cage.id}`}>
                    {cage.roomNumber} / {cage.rackNumber} / {cage.cageNumber}
                  </Link>
                  <p
                    className="mt-1 wrap-value font-mono text-xs uppercase tracking-[0.08em] text-[var(--muted)]"
                    data-testid="cage-row-barcode"
                  >
                    {cage.barcode}
                  </p>
                </div>
                <Badge variant={statusVariant(cage.status)}>{cage.status}</Badge>
              </div>
              <div className="metadata-line">
                <span>{cage.labName ?? cage.labCode ?? "Unassigned"}</span>
                <span>·</span>
                <CapacitySummary cage={cage} />
                <span>·</span>
                <span>{cage.billingCutoffAt ? `Ended ${formatBillingCutoff(cage.billingCutoffAt)}` : `${formatDailyRate(cage)}/day`}</span>
              </div>
              <div className="grid gap-1 text-xs text-[var(--muted)]">
                <p className="wrap-value">
                  <span className="font-medium text-[var(--muted-strong)]">Sex mix</span> {cage.sexComposition}
                </p>
                <p className="wrap-value">
                  <span className="font-medium text-[var(--muted-strong)]">Project</span> {cage.projectSummary || "None"}
                </p>
              </div>
              {cage.warningCount ? <WarningSummary cage={cage} /> : null}
              <div className="min-w-0">
                <p className="wrap-value text-sm text-[var(--muted-strong)]">{cage.strainSummary}</p>
                <div className="mt-2">
                  <ValueChips emptyLabel="Empty" values={cage.animalIdentifiers.slice(0, 5)} />
                </div>
                {cage.animalIdentifiers.length > 5 ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">+{cage.animalIdentifiers.length - 5} more</p>
                ) : null}
              </div>
              <div className="action-row">
                <Link aria-label={`Scan cage ${cage.barcode}`} className="action-chip action-chip-primary" href={`/scan/${cage.barcode}`}>
                  Scan
                </Link>
                <Link aria-label={`Open cage ${cage.barcode}`} className="action-chip" href={`/cages/${cage.id}`}>
                  Open
                </Link>
                <RowActionMenu label="More">
                  <Link className="table-action justify-start" href={`/cages/labels?cageId=${cage.id}`}>
                    Print cage label
                  </Link>
                  <Link className="table-action justify-start" href={`/billing?cageId=${cage.id}`}>
                    Billing history
                  </Link>
                </RowActionMenu>
              </div>
            </article>
          ))}
        </div>
      </div>
      <details className="dense-disclosure hidden md:block">
        <summary>
          Dense details
          <span className="text-xs font-normal text-[var(--muted)]">Animal IDs and project summaries</span>
        </summary>
        <div className="data-table-wrap rounded-t-none border-x-0 border-b-0">
          <table className="data-table compact-table min-w-[760px]">
            <thead>
              <tr>
                {[
                  "Cage",
                  "Animal lab IDs",
                  "Sex mix",
                  "Project",
                  "Charge state",
                ].map((header) => (
                  <th key={header}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleData.map((cage) => (
                <tr key={cage.id}>
                  <td className="min-w-[10rem]">
                    <Link className="wrap-value font-medium hover:text-[var(--accent)]" href={`/cages/${cage.id}`}>
                      {cage.roomNumber} / {cage.rackNumber} / {cage.cageNumber}
                    </Link>
                    <p className="mt-1 wrap-value font-mono text-xs text-[var(--muted)]">{cage.barcode}</p>
                  </td>
                  <td>
                    <ValueChips emptyLabel="Empty" values={cage.animalLabIdentifiers} />
                  </td>
                  <td className="wrap-value text-sm">{cage.sexComposition}</td>
                  <td className="wrap-value text-sm text-[var(--muted)]">{cage.projectSummary}</td>
                  <td className="wrap-value text-sm">
                    {cage.chargeState}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {filteredData.length ? null : (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          No cages match the current filters. Clear the search, widen the status filter, or export the full cage list
          instead.
        </div>
      )}
    </div>
  );
}
