"use client";

import Form from "next/form";
import Link from "next/link";
import { useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { InventoryPagination } from "@/components/app/inventory-pagination";
import type { AnimalInventoryQuery } from "@/lib/animals-read";
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

type ColonyTableProps = {
  data: AnimalListItem[];
  page: number;
  pageCount: number;
  pageSize: number;
  query: AnimalInventoryQuery;
  totalCount: number;
};

export function ColonyTable({ data, page, pageCount, pageSize, query, totalCount }: ColonyTableProps) {
  const filtersActive = Boolean(query.search || query.status !== "all" || query.availableOnly);

  const currentViewExportHref = useMemo(() => {
    const params = new URLSearchParams();

    if (query.search) {
      params.set("search", query.search);
    }

    if (query.status !== "all") {
      params.set("status", query.status);
    }

    if (query.availableOnly) {
      params.set("availableOnly", "true");
    }

    const serializedQuery = params.toString();

    return `/api/exports/animals${serializedQuery ? `?${serializedQuery}` : ""}`;
  }, [query.availableOnly, query.search, query.status]);

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
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-5" data-testid="colony-table">
      <div className="space-y-3">
        <Form action="/animals" className="grid min-w-0 gap-3 md:grid-cols-[minmax(12rem,1fr)_auto] 2xl:grid-cols-[minmax(16rem,1fr)_auto_auto_auto]" scroll={false}>
          <Input
            defaultValue={query.search}
            name="search"
            placeholder="Search animal ID, lab ID, genotype, strain, or cage"
            data-testid="colony-search"
          />
          <select
            defaultValue={query.status}
            name="status"
            className="h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
            aria-label="Filter animals by status"
          >
            <option value="all">All statuses</option>
            <option value="colony_holding">Colony holding</option>
            <option value="breeding">Breeding</option>
            <option value="reserved">Reserved</option>
            <option value="in_experiment">In experiment</option>
          </select>
          <label className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--muted)]">
            <input
              defaultChecked={query.availableOnly}
              name="availableOnly"
              type="checkbox"
              value="true"
            />
            <span className="truncate">Available for experiment only</span>
          </label>
          <input name="pageSize" type="hidden" value={pageSize} />
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)]"
            data-testid="colony-filter-submit"
            type="submit"
          >
            Apply filters
          </button>
        </Form>
        <div className="count-strip justify-between">
          <p className="text-sm text-[var(--muted)]">
            <span className="font-medium text-[var(--ink)]">{totalCount}</span> matching mice across the authorized colony
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {filtersActive ? (
              <Link
                href="/animals"
                className="inline-flex h-11 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)] md:h-9"
              >
                Clear filters
              </Link>
            ) : null}
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
      <InventoryPagination
        basePath="/animals"
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        query={{
          availableOnly: query.availableOnly,
          pageSize,
          search: query.search,
          status: query.status,
        }}
        totalCount={totalCount}
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
