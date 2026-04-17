"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import type { CageListItem } from "@/lib/types";

export function CageTable({ data }: { data: CageListItem[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CageListItem["status"]>("all");
  const [warningsOnly, setWarningsOnly] = useState(false);

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
        const matchesSearch = haystack.includes(search.toLowerCase());
        const matchesStatus = statusFilter === "all" ? true : cage.status === statusFilter;
        const matchesWarnings = warningsOnly ? cage.warningCount > 0 : true;

        return matchesSearch && matchesStatus && matchesWarnings;
      }),
    [data, search, statusFilter, warningsOnly],
  );

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
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search room, rack, cage, barcode, or strain"
            data-testid="cage-search"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="h-11 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm text-[var(--ink)]"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="breeding">Breeding</option>
            <option value="experiment">Experiment</option>
            <option value="quarantine">Quarantine</option>
            <option value="retired">Retired</option>
            <option value="closed">Closed</option>
          </select>
          <label className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
            <input checked={warningsOnly} onChange={(event) => setWarningsOnly(event.target.checked)} type="checkbox" />
            Warnings only
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
          <p className="text-sm text-[var(--muted)]">
            Showing <span className="font-medium text-[var(--ink)]">{filteredData.length}</span> of{" "}
            <span className="font-medium text-[var(--ink)]">{data.length}</span> cages
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={currentViewExportHref}
              prefetch={false}
              className="inline-flex h-10 items-center justify-center rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)]"
              data-testid="cage-export-current"
            >
              Export current view
            </Link>
            <Link
              href="/api/exports/cages"
              prefetch={false}
              className="inline-flex h-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)]"
              data-testid="cage-export-all"
            >
              Export all cages
            </Link>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-[24px] border border-[var(--line)]">
        <table className="min-w-full border-collapse">
          <thead className="bg-[var(--surface-2)] text-left text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            <tr>
              {["Cage", "Barcode", "Status", "Occupants", "Sex mix", "Strain summary", "Warnings"].map((header) => (
                <th key={header} className="px-5 py-4 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)] bg-white/70">
            {filteredData.map((cage) => (
              <tr key={cage.id} data-testid="cage-row">
                <td className="px-5 py-4">
                  <Link className="font-medium hover:text-[var(--accent)]" href={`/cages/${cage.id}`}>
                    {cage.roomNumber} / {cage.rackNumber} / {cage.cageNumber}
                  </Link>
                </td>
                <td className="px-5 py-4 font-mono text-sm text-[var(--muted)]" data-testid="cage-row-barcode">
                  {cage.barcode}
                </td>
                <td className="px-5 py-4 capitalize">{cage.status}</td>
                <td className="px-5 py-4">{cage.occupantCount}</td>
                <td className="px-5 py-4">{cage.sexComposition}</td>
                <td className="px-5 py-4 text-sm text-[var(--muted)]">{cage.strainSummary}</td>
                <td className="px-5 py-4">{cage.warningCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filteredData.length ? null : (
        <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-[var(--surface-2)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          No cages match the current filters. Clear the search, widen the status filter, or export the full cage list
          instead.
        </div>
      )}
    </div>
  );
}
