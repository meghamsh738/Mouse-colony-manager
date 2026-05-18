"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

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

export function CageTable({ data }: { data: CageListItem[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CageListItem["status"]>("all");
  const [warningsOnly, setWarningsOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_RECORDS);
  const deferredSearch = useDeferredValue(search);

  const filteredData = useMemo(
    () =>
      data.filter((cage) => {
        const haystack = [
          cage.roomNumber,
          cage.rackNumber,
          cage.cageNumber,
          cage.barcode,
          cage.sexComposition,
          cage.strainSummary,
        ]
          .join(" ")
          .toLowerCase();
        const matchesSearch = haystack.includes(deferredSearch.toLowerCase());
        const matchesStatus = statusFilter === "all" ? true : cage.status === statusFilter;
        const matchesWarnings = warningsOnly ? cage.warningCount > 0 : true;

        return matchesSearch && matchesStatus && matchesWarnings;
      }),
    [data, deferredSearch, statusFilter, warningsOnly],
  );

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_RECORDS);
  }, [data.length, deferredSearch, statusFilter, warningsOnly]);

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

  return (
    <div className="space-y-5" data-testid="cage-table">
      <div className="space-y-3">
        <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(12rem,1fr)_auto_auto]">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search room, rack, cage, barcode, or strain"
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
          <label className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--muted)]">
            <input checked={warningsOnly} onChange={(event) => setWarningsOnly(event.target.checked)} type="checkbox" />
            <span className="truncate">Warnings only</span>
          </label>
        </div>
        <div className="count-strip justify-between">
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
              href={currentViewExportHref}
              prefetch={false}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)]"
              data-testid="cage-export-current"
            >
              Export current view
            </Link>
            <Link
              href="/api/exports/cages"
              prefetch={false}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)]"
              data-testid="cage-export-all"
            >
              Export all cages
            </Link>
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
      <div className="grid gap-3 md:hidden">
        {visibleData.map((cage) => (
          <article key={cage.id} className="mobile-record">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link className="font-semibold hover:text-[var(--accent)]" href={`/cages/${cage.id}`}>
                  {cage.roomNumber} / {cage.rackNumber} / {cage.cageNumber}
                </Link>
                <p className="mt-1 font-mono text-xs uppercase tracking-[0.1em] text-[var(--muted)]">{cage.barcode}</p>
              </div>
              <Badge variant={statusVariant(cage.status)}>{cage.status}</Badge>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Occupants</dt>
                <dd className="mt-1 font-semibold text-[var(--ink)]">{cage.occupantCount}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Sex mix</dt>
                <dd className="mt-1 font-semibold text-[var(--ink)]">{cage.sexComposition}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Strain summary</dt>
                <dd className="mt-1 text-[var(--muted)]">{cage.strainSummary}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Warnings</dt>
                <dd className="mt-1 font-semibold text-[var(--ink)]">{cage.warningCount}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <div className="data-table-wrap hidden md:block">
        <table className="data-table min-w-[900px]">
          <thead>
            <tr>
              {["Cage", "Barcode", "Status", "Occupants", "Sex mix", "Strain summary", "Warnings"].map((header) => (
                <th key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleData.map((cage) => (
              <tr key={cage.id} data-testid="cage-row">
                <td>
                  <Link className="font-medium hover:text-[var(--accent)]" href={`/cages/${cage.id}`}>
                    {cage.roomNumber} / {cage.rackNumber} / {cage.cageNumber}
                  </Link>
                </td>
                <td className="font-mono text-sm text-[var(--muted)]" data-testid="cage-row-barcode">
                  {cage.barcode}
                </td>
                <td className="capitalize">{cage.status}</td>
                <td>{cage.occupantCount}</td>
                <td>{cage.sexComposition}</td>
                <td className="text-sm text-[var(--muted)]">{cage.strainSummary}</td>
                <td>{cage.warningCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filteredData.length ? null : (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          No cages match the current filters. Clear the search, widen the status filter, or export the full cage list
          instead.
        </div>
      )}
    </div>
  );
}
