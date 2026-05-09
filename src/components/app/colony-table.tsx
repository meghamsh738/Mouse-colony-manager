"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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

  const filteredData = useMemo(
    () =>
      data.filter((animal) => {
        const haystack = [animal.animalId, animal.labId, animal.strain, animal.genotypeSummary, animal.cageLabel]
          .join(" ")
          .toLowerCase();
        const matchesSearch = haystack.includes(search.toLowerCase());
        const matchesStatus = statusFilter === "all" ? true : animal.status === statusFilter;
        const matchesAvailability = availabilityFilter ? animal.availableForExperiment : true;

        return matchesSearch && matchesStatus && matchesAvailability;
      }),
    [availabilityFilter, data, search, statusFilter],
  );

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
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-5" data-testid="colony-table">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search animal ID, lab ID, genotype, strain, or cage"
            data-testid="colony-search"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="h-11 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm text-[var(--ink)]"
          >
            <option value="all">All statuses</option>
            <option value="colony_holding">Colony holding</option>
            <option value="breeding">Breeding</option>
            <option value="reserved">Reserved</option>
            <option value="in_experiment">In experiment</option>
          </select>
          <label className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
            <input
              checked={availabilityFilter}
              onChange={(event) => setAvailabilityFilter(event.target.checked)}
              type="checkbox"
            />
            Available for experiment only
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
          <p className="text-sm text-[var(--muted)]">
            Showing <span className="font-medium text-[var(--ink)]">{filteredData.length}</span> of{" "}
            <span className="font-medium text-[var(--ink)]">{data.length}</span> active mice
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={currentViewExportHref}
              prefetch={false}
              className="inline-flex h-10 items-center justify-center rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)]"
              data-testid="animal-export-current"
            >
              Export current view
            </Link>
            <Link
              href="/api/exports/animals"
              prefetch={false}
              className="inline-flex h-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)]"
              data-testid="animal-export-all"
            >
              Export all animals
            </Link>
          </div>
        </div>
      </div>
      <div className="grid gap-3 md:hidden">
        {table.getRowModel().rows.map((row) => {
          const animal = row.original;

          return (
            <article key={animal.id} className="rounded-[24px] border border-[var(--line)] bg-white/70 p-4">
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
      <div className="hidden overflow-x-auto rounded-[24px] border border-[var(--line)] md:block">
        <table className="min-w-[980px] border-collapse text-left">
          <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-4 py-3 font-medium">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-[var(--line)] bg-white/70">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="align-top">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-4 text-sm text-[var(--ink)]">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.getRowModel().rows.length ? null : (
        <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-[var(--surface-2)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          No animals match the current filters. Clear the search, widen the status filter, or export the full colony
          list instead.
        </div>
      )}
    </div>
  );
}
