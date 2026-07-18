"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { AnimalListItem } from "@/lib/types";
import {
  INITIAL_VISIBLE_RECORDS,
  VISIBLE_RECORD_BATCH,
  VisibleRecordControls,
} from "@/components/app/visible-record-controls";

const columnHelper = createColumnHelper<AnimalListItem>();

function statusVariant(status: AnimalListItem["status"]) {
  if (status === "in_experiment" || status === "reserved") {
    return "info";
  }

  if (status === "breeding") {
    return "warning";
  }

  return "neutral";
}

export function ColonyTable({ data }: { data: AnimalListItem[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AnimalListItem["status"]>("all");
  const [availabilityFilter, setAvailabilityFilter] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_RECORDS);
  const deferredSearch = useDeferredValue(search);

  const filteredData = useMemo(
    () =>
      data.filter((animal) => {
        const haystack = [animal.animalId, animal.labId, animal.strain, animal.genotypeSummary, animal.cageLabel]
          .join(" ")
          .toLowerCase();
        const matchesSearch = haystack.includes(deferredSearch.toLowerCase());
        const matchesStatus = statusFilter === "all" ? true : animal.status === statusFilter;
        const matchesAvailability = availabilityFilter ? animal.availableForExperiment : true;

        return matchesSearch && matchesStatus && matchesAvailability;
      }),
    [availabilityFilter, data, deferredSearch, statusFilter],
  );

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_RECORDS);
  }, [availabilityFilter, data.length, deferredSearch, statusFilter]);

  const visibleData = useMemo(() => filteredData.slice(0, visibleCount), [filteredData, visibleCount]);

  const currentViewExportHref = useMemo(() => {
    const params = new URLSearchParams();

    if (search.trim()) {
      params.set("search", search.trim());
    }

    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }

    if (availabilityFilter) {
      params.set("availableOnly", "true");
    }

    const query = params.toString();

    return `/api/exports/animals${query ? `?${query}` : ""}`;
  }, [availabilityFilter, search, statusFilter]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("animalId", {
        header: "Animal",
        cell: (info) => (
          <div className="space-y-1">
            <Link href={`/animals/${info.row.original.id}`} className="font-medium hover:text-[var(--accent)]">
              {info.getValue()}
            </Link>
            <p className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">{info.row.original.labId}</p>
          </div>
        ),
      }),
      columnHelper.accessor("sex", {
        header: "Sex",
        cell: (info) => <span className="capitalize">{info.getValue()}</span>,
      }),
      columnHelper.accessor("ageLabel", {
        header: "Age",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("strain", {
        header: "Strain",
        cell: (info) => <span className="text-sm text-[var(--muted)]">{info.getValue()}</span>,
      }),
      columnHelper.accessor("genotypeSummary", {
        header: "Genotype",
        cell: (info) => <span className="font-mono text-xs text-[var(--muted)]">{info.getValue()}</span>,
      }),
      columnHelper.accessor("cageLabel", {
        header: "Cage",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (info) => <Badge variant={statusVariant(info.getValue())}>{info.getValue().replaceAll("_", " ")}</Badge>,
      }),
      columnHelper.display({
        id: "warnings",
        header: "Warnings",
        cell: (info) =>
          info.row.original.warnings.length ? (
            <p className="max-w-[280px] text-sm text-amber-900">{info.row.original.warnings[0]}</p>
          ) : (
            <span className="text-sm text-[var(--muted)]">None</span>
          ),
      }),
    ],
    [],
  );

  // TanStack Table owns stateful table instance creation here; disabling the
  // React Compiler compatibility warning is appropriate for this boundary.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: visibleData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-5" data-testid="colony-table">
      <div className="space-y-3">
        <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(12rem,1fr)_auto] 2xl:grid-cols-[minmax(16rem,1fr)_auto_auto]">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search animal ID, lab ID, genotype, strain, or cage"
            data-testid="colony-search"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
          >
            <option value="all">All statuses</option>
            <option value="colony_holding">Colony holding</option>
            <option value="breeding">Breeding</option>
            <option value="reserved">Reserved</option>
            <option value="in_experiment">In experiment</option>
          </select>
          <label className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--muted)]">
            <input
              checked={availabilityFilter}
              onChange={(event) => setAvailabilityFilter(event.target.checked)}
              type="checkbox"
            />
            <span className="truncate">Available for experiment only</span>
          </label>
        </div>
        <div className="count-strip justify-between">
          <p className="text-sm text-[var(--muted)]">
            Showing <span className="font-medium text-[var(--ink)]">{visibleData.length}</span> of{" "}
            <span className="font-medium text-[var(--ink)]">{filteredData.length}</span> matching mice
            {filteredData.length === data.length ? "" : (
              <>
                {" "}
                from <span className="font-medium text-[var(--ink)]">{data.length}</span> active mice
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={currentViewExportHref}
              prefetch={false}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)] md:h-9"
              data-testid="animal-export-current"
            >
              Export current view
            </Link>
            <Link
              href="/api/exports/animals"
              prefetch={false}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)] md:h-9"
              data-testid="animal-export-all"
            >
              Export all animals
            </Link>
          </div>
        </div>
      </div>
      <VisibleRecordControls
        matchingCount={filteredData.length}
        noun="mice"
        onShowAll={() => setVisibleCount(filteredData.length)}
        onShowMore={() =>
          setVisibleCount((current) => Math.min(current + VISIBLE_RECORD_BATCH, filteredData.length))
        }
        totalCount={data.length}
        visibleCount={visibleData.length}
      />
      <div className="grid gap-3 md:hidden">
        {table.getRowModel().rows.map((row) => {
          const animal = row.original;

          return (
            <article key={animal.id} className="mobile-record">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link href={`/animals/${animal.id}`} className="font-semibold hover:text-[var(--accent)]">
                    {animal.animalId}
                  </Link>
                  <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">{animal.labId}</p>
                </div>
                <Badge variant={statusVariant(animal.status)}>{animal.status.replaceAll("_", " ")}</Badge>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Sex</dt>
                  <dd className="mt-1 capitalize text-[var(--ink)]">{animal.sex}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Age</dt>
                  <dd className="mt-1 text-[var(--ink)]">{animal.ageLabel}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Line</dt>
                  <dd className="mt-1 text-[var(--muted)]">{animal.strain}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Genotype</dt>
                  <dd className="mt-1 font-mono text-xs text-[var(--muted)]">{animal.genotypeSummary}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Cage</dt>
                  <dd className="mt-1 text-[var(--ink)]">{animal.cageLabel}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Warning</dt>
                  <dd className="mt-1 text-amber-900">{animal.warnings[0] ?? "None"}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
      <div className="data-table-wrap hidden md:block">
        <table className="data-table min-w-[980px]">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="align-top">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="text-sm text-[var(--ink)]">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.getRowModel().rows.length ? null : (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          No animals match the current filters. Clear the search, widen the status filter, or export the full colony
          list instead.
        </div>
      )}
    </div>
  );
}
