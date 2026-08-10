"use client";

import Form from "next/form";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";

import { InventoryPagination } from "@/components/app/inventory-pagination";
import { RowActionMenu } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { CageInventoryQuery } from "@/lib/cages-read";
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

type CageTableProps = {
  data: CageListItem[];
  filterOptions: {
    labs: Array<{ id: string; label: string }>;
    chargeCategories: Array<{ id: string; label: string }>;
  };
  page: number;
  pageCount: number;
  pageSize: number;
  query: CageInventoryQuery;
  totalCount: number;
};

export function CageTable({ data, filterOptions, page, pageCount, pageSize, query, totalCount }: CageTableProps) {
  const filtersActive = Boolean(
    query.search ||
    query.status !== "all" ||
    query.labId !== "all" ||
    query.chargeCategoryId !== "all" ||
    query.chargeState !== "all" ||
    query.occupancy !== "all" ||
    query.sex !== "all" ||
    query.warningsOnly,
  );
  const currentViewExportHref = useMemo(() => {
    const params = new URLSearchParams();

    if (query.search) {
      params.set("search", query.search);
    }

    if (query.status !== "all") {
      params.set("status", query.status);
    }

    if (query.warningsOnly) {
      params.set("warningsOnly", "true");
    }

    const serializedQuery = params.toString();

    return `/api/exports/cages${serializedQuery ? `?${serializedQuery}` : ""}`;
  }, [query.search, query.status, query.warningsOnly]);

  const currentViewPrintHref = useMemo(() => {
    const params = new URLSearchParams();

    if (query.search) {
      params.set("search", query.search);
    }

    if (query.status !== "all") {
      params.set("status", query.status);
    }

    if (query.warningsOnly) {
      params.set("warningsOnly", "true");
    }

    const serializedQuery = params.toString();

    return `/cages/labels${serializedQuery ? `?${serializedQuery}` : ""}`;
  }, [query.search, query.status, query.warningsOnly]);

  return (
    <div className="space-y-4" data-testid="cage-table">
      <div className="space-y-2.5">
        <Form action="/cages" className="space-y-2.5" scroll={false}>
          <div className="filter-toolbar">
            <Input
              defaultValue={query.search}
              name="search"
              placeholder="Search cage, animal, lab, strain, project"
              data-testid="cage-search"
            />
            <select
              aria-label="Filter cages by status"
              className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
              defaultValue={query.status}
              name="status"
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
              <input defaultChecked={query.warningsOnly} name="warningsOnly" type="checkbox" value="true" />
              <span className="truncate">Warnings only</span>
            </label>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)]"
              data-testid="cage-filter-submit"
              type="submit"
            >
              Apply filters
            </button>
          </div>
          <details className="group rounded-lg border border-[var(--line)] bg-white/42" open={Boolean(
            query.labId !== "all" ||
            query.chargeCategoryId !== "all" ||
            query.chargeState !== "all" ||
            query.occupancy !== "all" ||
            query.sex !== "all"
          )}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-medium text-[var(--muted)] [&::-webkit-details-marker]:hidden">
              Advanced filters
              <span className="group-open:hidden">+</span>
              <span className="hidden group-open:inline">-</span>
            </summary>
            <div className="grid min-w-0 gap-3 border-t border-[var(--line)] p-3 sm:grid-cols-2 lg:grid-cols-5">
              <select
                aria-label="Filter cages by lab"
                className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
                defaultValue={query.labId}
                name="labId"
              >
                <option value="all">All labs</option>
                {filterOptions.labs.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <select
                aria-label="Filter cages by rate"
                className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
                defaultValue={query.chargeCategoryId}
                name="chargeCategoryId"
              >
                <option value="all">All rates</option>
                {filterOptions.chargeCategories.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <select
                aria-label="Filter cages by charge state"
                className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
                defaultValue={query.chargeState}
                name="chargeState"
              >
                <option value="all">All charge states</option>
                <option value="chargeable">Chargeable</option>
                <option value="unpriced">Unpriced</option>
                <option value="exited">Exited</option>
              </select>
              <select
                aria-label="Filter cages by occupancy"
                className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
                defaultValue={query.occupancy}
                name="occupancy"
              >
                <option value="all">All occupancy</option>
                <option value="occupied">Occupied</option>
                <option value="empty">Empty</option>
              </select>
              <select
                aria-label="Filter cages by sex mix"
                className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
                defaultValue={query.sex}
                name="sex"
              >
                <option value="all">All sex mix</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="mixed">Mixed</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
          </details>
          <input name="pageSize" type="hidden" value={pageSize} />
        </Form>
        <div className="utility-bar">
          <p className="text-sm text-[var(--muted)]">
            <span className="font-medium text-[var(--ink)]">{totalCount}</span> matching cages across the authorized colony
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {filtersActive ? (
              <Link
                className="inline-flex h-11 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)] md:h-9"
                href="/cages"
              >
                Clear filters
              </Link>
            ) : null}
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
      <InventoryPagination
        basePath="/cages"
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        query={{
          search: query.search,
          status: query.status,
          labId: query.labId,
          chargeCategoryId: query.chargeCategoryId,
          chargeState: query.chargeState,
          occupancy: query.occupancy,
          sex: query.sex,
          warningsOnly: query.warningsOnly,
          pageSize,
        }}
        totalCount={totalCount}
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
            {data.map((cage) => (
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
          {data.map((cage) => (
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
              {data.map((cage) => (
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
      {data.length ? null : (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          No cages match the current filters. Clear the search, widen the status filter, or export the full cage list
          instead.
        </div>
      )}
    </div>
  );
}
