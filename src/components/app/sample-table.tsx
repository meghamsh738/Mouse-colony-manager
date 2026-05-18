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
import {
  INITIAL_VISIBLE_RECORDS,
  VISIBLE_RECORD_BATCH,
  VisibleRecordControls,
} from "@/components/app/visible-record-controls";
import type { SampleInventoryItem } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const columnHelper = createColumnHelper<SampleInventoryItem>();

function statusVariant(status: SampleInventoryItem["status"]) {
  if (status === "stored") {
    return "success";
  }

  if (status === "allocated") {
    return "info";
  }

  if (status === "discarded") {
    return "danger";
  }

  if (status === "collected") {
    return "warning";
  }

  return "neutral";
}

export function SampleTable({ data }: { data: SampleInventoryItem[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SampleInventoryItem["status"]>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_RECORDS);
  const deferredSearch = useDeferredValue(search);

  const sampleTypes = useMemo(
    () => Array.from(new Set(data.map((record) => record.sampleType))).sort((left, right) => left.localeCompare(right)),
    [data],
  );

  const filteredData = useMemo(
    () =>
      data.filter((record) => {
        const haystack = [
          record.sampleLabel,
          record.sampleType,
          record.animalCode,
          record.labId,
          record.projectCode ?? "",
          record.storageLocation ?? "",
          record.quantityLabel ?? "",
          record.notes ?? "",
        ]
          .join(" ")
          .toLowerCase();

        const matchesSearch = haystack.includes(deferredSearch.toLowerCase());
        const matchesStatus = statusFilter === "all" ? true : record.status === statusFilter;
        const matchesType = typeFilter === "all" ? true : record.sampleType === typeFilter;

        return matchesSearch && matchesStatus && matchesType;
      }),
    [data, deferredSearch, statusFilter, typeFilter],
  );

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_RECORDS);
  }, [data.length, deferredSearch, statusFilter, typeFilter]);

  const visibleData = useMemo(() => filteredData.slice(0, visibleCount), [filteredData, visibleCount]);

  const counts = useMemo(
    () =>
      filteredData.reduce(
        (summary, record) => {
          summary.total += 1;
          summary[record.status] += 1;
          return summary;
        },
        {
          total: 0,
          collected: 0,
          stored: 0,
          allocated: 0,
          consumed: 0,
          discarded: 0,
        },
      ),
    [filteredData],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor("sampleLabel", {
        header: "Sample",
        cell: (info) => (
          <div className="space-y-1">
            <p className="font-medium text-[var(--ink)]">{info.getValue()}</p>
            <p className="text-sm text-[var(--muted)]">{info.row.original.sampleType}</p>
            {info.row.original.quantityLabel ? (
              <p className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">{info.row.original.quantityLabel}</p>
            ) : null}
          </div>
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (info) => <Badge variant={statusVariant(info.getValue())}>{info.getValue()}</Badge>,
      }),
      columnHelper.accessor("collectedAt", {
        header: "Collected",
        cell: (info) => formatDate(info.getValue()),
      }),
      columnHelper.display({
        id: "animal",
        header: "Animal",
        cell: (info) => (
          <div className="space-y-1">
            <Link href={`/animals/${info.row.original.animalId}`} className="font-medium hover:text-[var(--accent)]">
              {info.row.original.animalCode}
            </Link>
            <p className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">{info.row.original.labId}</p>
          </div>
        ),
      }),
      columnHelper.accessor("projectCode", {
        header: "Project",
        cell: (info) => info.getValue() ?? <span className="text-sm text-[var(--muted)]">None</span>,
      }),
      columnHelper.accessor("storageLocation", {
        header: "Storage",
        cell: (info) => info.getValue() ?? <span className="text-sm text-[var(--muted)]">Pending</span>,
      }),
      columnHelper.accessor("notes", {
        header: "Notes",
        cell: (info) =>
          info.getValue() ? (
            <p className="max-w-[320px] text-sm leading-6 text-[var(--muted)]">{info.getValue()}</p>
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
    <div className="space-y-5" data-testid="sample-table">
      <div className="space-y-3">
        <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(12rem,1fr)_auto_auto]">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search sample label, animal ID, project, storage, or notes"
            className="min-w-0"
            data-testid="sample-search"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="h-11 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] md:w-auto"
          >
            <option value="all">All statuses</option>
            <option value="stored">Stored</option>
            <option value="collected">Collected</option>
            <option value="allocated">Allocated</option>
            <option value="consumed">Consumed</option>
            <option value="discarded">Discarded</option>
          </select>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="h-11 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] md:w-auto"
          >
            <option value="all">All sample types</option>
            {sampleTypes.map((sampleType) => (
              <option key={sampleType} value={sampleType}>
                {sampleType}
              </option>
            ))}
          </select>
        </div>
        <div className="count-strip">
          <span>
            Showing <span className="font-medium text-[var(--ink)]">{visibleData.length}</span> of{" "}
            <span className="font-medium text-[var(--ink)]">{counts.total}</span> matching records
          </span>
          <span>
            <span className="font-medium text-[var(--ink)]">{counts.stored}</span> stored
          </span>
          <span>
            <span className="font-medium text-[var(--ink)]">{counts.allocated}</span> allocated
          </span>
          <span>
            <span className="font-medium text-[var(--ink)]">{counts.consumed + counts.discarded}</span> closed out
          </span>
        </div>
      </div>
      <VisibleRecordControls
        matchingCount={filteredData.length}
        noun="samples"
        onShowAll={() => setVisibleCount(filteredData.length)}
        onShowMore={() =>
          setVisibleCount((current) => Math.min(current + VISIBLE_RECORD_BATCH, filteredData.length))
        }
        totalCount={data.length}
        visibleCount={visibleData.length}
      />
      <div className="grid gap-3 md:hidden">
        {table.getRowModel().rows.map((row) => {
          const sample = row.original;

          return (
            <article key={sample.id} className="mobile-record">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[var(--ink)]">{sample.sampleLabel}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{sample.sampleType}</p>
                  {sample.quantityLabel ? (
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">{sample.quantityLabel}</p>
                  ) : null}
                </div>
                <Badge variant={statusVariant(sample.status)}>{sample.status}</Badge>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Collected</dt>
                  <dd className="mt-1 text-[var(--ink)]">{formatDate(sample.collectedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Project</dt>
                  <dd className="mt-1 text-[var(--ink)]">{sample.projectCode ?? "None"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Animal</dt>
                  <dd className="mt-1">
                    <Link href={`/animals/${sample.animalId}`} className="font-medium hover:text-[var(--accent)]">
                      {sample.animalCode}
                    </Link>
                    <span className="ml-2 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">{sample.labId}</span>
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Storage</dt>
                  <dd className="mt-1 text-[var(--muted)]">{sample.storageLocation ?? "Pending"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Notes</dt>
                  <dd className="mt-1 text-[var(--muted)]">{sample.notes ?? "None"}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
      <div className="data-table-wrap hidden md:block">
        <table className="data-table min-w-[960px]">
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
          No samples match the current filters. Clear the search or widen the status and type filters to review the full inventory.
        </div>
      )}
    </div>
  );
}
