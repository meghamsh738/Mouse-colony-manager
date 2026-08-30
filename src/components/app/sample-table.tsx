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
import { RowActionMenu } from "@/components/app/worksheet-shell";
import { SampleInlineEditForm } from "@/components/app/sample-inline-edit-form";
import { InventoryPagination } from "@/components/app/inventory-pagination";
import type { SampleInventoryQuery } from "@/lib/samples-read";
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

type SampleTableProps = {
  data: SampleInventoryItem[];
  experimentOptions: Array<{ id: string; label: string; status: string }>;
  canManage: boolean;
  page: number;
  pageCount: number;
  pageSize: number;
  query: SampleInventoryQuery;
  sampleTypes: string[];
  totalCount: number;
};

function editableExperimentOptions(
  options: SampleTableProps["experimentOptions"],
  currentExperimentId: string | null | undefined,
) {
  return options.filter(
    (option) => option.status === "planned" || option.status === "active" || option.id === currentExperimentId,
  );
}

export function SampleTable({
  canManage,
  data,
  experimentOptions,
  page,
  pageCount,
  pageSize,
  query,
  sampleTypes,
  totalCount,
}: SampleTableProps) {
  const filtersActive = Boolean(
    query.search || query.status !== "all" || query.sampleType !== "all" || query.experimentId !== "all",
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
            {info.row.original.correction ? <p className="text-xs font-medium text-emerald-800" data-testid={`sample-correction-${info.row.original.id}`}>Corrected metadata · {info.row.original.correction.requestId.slice(0, 12)}</p> : null}
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
      columnHelper.accessor("experimentCode", {
        header: "Experiment",
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
      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: (info) => canManage ? (
          <RowActionMenu label="Edit">
            <SampleInlineEditForm
              experimentOptions={editableExperimentOptions(experimentOptions, info.row.original.experimentId)}
              sample={info.row.original}
            />
          </RowActionMenu>
        ) : <span className="text-xs text-[var(--muted)]">View only</span>,
      }),
    ],
    [canManage, experimentOptions],
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
    <div className="space-y-5" data-testid="sample-table">
      <div className="space-y-3">
        <Form action="/samples" className="grid min-w-0 gap-3 md:grid-cols-[minmax(12rem,1fr)_auto_auto] 2xl:grid-cols-[minmax(16rem,1fr)_auto_auto_auto_auto]" scroll={false}>
          <Input
            defaultValue={query.search}
            name="search"
            placeholder="Search sample label, animal ID, project, storage, or notes"
            className="min-w-0"
            data-testid="sample-search"
          />
          <select
            defaultValue={query.status}
            name="status"
            className="h-11 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] md:w-auto"
            aria-label="Filter biosamples by status"
          >
            <option value="all">All statuses</option>
            <option value="stored">Stored</option>
            <option value="collected">Collected</option>
            <option value="allocated">Allocated</option>
            <option value="consumed">Consumed</option>
            <option value="discarded">Discarded</option>
          </select>
          <select
            defaultValue={query.experimentId}
            name="experimentId"
            className="h-11 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] md:w-auto"
            aria-label="Filter biosamples by experiment"
          >
            <option value="all">All experiments</option>
            <option value="none">No experiment</option>
            {experimentOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          <select
            defaultValue={query.sampleType}
            name="sampleType"
            className="h-11 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] md:w-auto"
            aria-label="Filter biosamples by sample type"
          >
            <option value="all">All sample types</option>
            {sampleTypes.map((sampleType) => (
              <option key={sampleType} value={sampleType}>
                {sampleType}
              </option>
            ))}
          </select>
          <input name="pageSize" type="hidden" value={pageSize} />
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            data-testid="sample-filter-submit"
            type="submit"
          >
            Apply filters
          </button>
        </Form>
        <div className="count-strip justify-between">
          <span><span className="font-medium text-[var(--ink)]">{totalCount}</span> matching biosamples across the authorized inventory</span>
          {filtersActive ? <Link href="/samples" className="text-sm font-medium text-[var(--accent)] hover:text-[var(--accent-strong)]">Clear filters</Link> : null}
        </div>
      </div>
      <InventoryPagination
        basePath="/samples"
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        query={{
          experimentId: query.experimentId,
          pageSize,
          sampleType: query.sampleType,
          search: query.search,
          status: query.status,
        }}
        totalCount={totalCount}
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
                  {sample.correction ? <p className="mt-1 text-xs font-medium text-emerald-800" data-testid={`sample-correction-mobile-${sample.id}`}>Corrected metadata · {sample.correction.requestId.slice(0, 12)}</p> : null}
                </div>
                <div className="action-row justify-end">
                  <Badge variant={statusVariant(sample.status)}>{sample.status}</Badge>
                  {canManage ? (
                    <RowActionMenu label="Edit">
                      <SampleInlineEditForm
                        experimentOptions={editableExperimentOptions(experimentOptions, sample.experimentId)}
                        sample={sample}
                      />
                    </RowActionMenu>
                  ) : null}
                </div>
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
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Experiment</dt>
                  <dd className="mt-1 text-[var(--ink)]">{sample.experimentCode ?? "None"}</dd>
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
