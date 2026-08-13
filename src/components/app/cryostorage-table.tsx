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
import { CryostorageInlineEditForm } from "@/components/app/cryostorage-inline-edit-form";
import { RowActionMenu } from "@/components/app/worksheet-shell";
import { InventoryPagination } from "@/components/app/inventory-pagination";
import type { CryostorageInventoryQuery } from "@/lib/cryostorage-read";
import type { CryostorageInventoryItem } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const columnHelper = createColumnHelper<CryostorageInventoryItem>();

function statusVariant(status: CryostorageInventoryItem["status"]) {
  if (status === "stored") {
    return "success";
  }

  if (status === "reserved") {
    return "info";
  }

  if (status === "recovered") {
    return "warning";
  }

  return "danger";
}

type CryostorageTableProps = {
  canManage: boolean;
  data: CryostorageInventoryItem[];
  page: number;
  pageCount: number;
  pageSize: number;
  query: CryostorageInventoryQuery;
  strainOptions: Array<{ id: string; label: string }>;
  totalCount: number;
};

export function CryostorageTable({ canManage, data, page, pageCount, pageSize, query, strainOptions, totalCount }: CryostorageTableProps) {
  const filtersActive = Boolean(query.search || query.status !== "all" || query.strainId !== "all");

  const columns = useMemo(
    () => [
      columnHelper.accessor("sampleLabel", {
        header: "Stored material",
        cell: (info) => (
          <div className="space-y-1">
            <p className="font-medium text-[var(--ink)]">{info.getValue()}</p>
            <p className="text-sm text-[var(--muted)]">{info.row.original.materialType}</p>
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
      columnHelper.accessor("labLabel", {
        header: "Lab",
        cell: (info) => <span className="wrap-value">{info.getValue()}</span>,
      }),
      columnHelper.accessor("storedAt", {
        header: "Stored",
        cell: (info) => formatDate(info.getValue()),
      }),
      columnHelper.accessor("strainName", {
        header: "Strain",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("projectCode", {
        header: "Project",
        cell: (info) => info.getValue() ?? <span className="text-sm text-[var(--muted)]">None</span>,
      }),
      columnHelper.accessor("storageLocation", {
        header: "Location",
        cell: (info) => info.getValue() ?? <span className="text-sm text-[var(--muted)]">Pending</span>,
      }),
      columnHelper.accessor("recoveryNotes", {
        header: "Recovery",
        cell: (info) =>
          info.getValue() ? (
            <p className="max-w-[320px] text-sm leading-6 text-[var(--muted)]">{info.getValue()}</p>
          ) : (
            <span className="text-sm text-[var(--muted)]">None</span>
          ),
      }),
      ...(canManage
        ? [columnHelper.display({
          id: "actions",
          header: "Actions",
          cell: (info) => (
            <RowActionMenu label="Edit">
              <CryostorageInlineEditForm record={info.row.original} />
            </RowActionMenu>
          ),
        })]
        : []),
    ],
    [canManage],
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
    <div className="space-y-5" data-testid="cryostorage-table">
      <div className="space-y-3">
        <Form action="/cryostorage" className="grid min-w-0 gap-3 md:grid-cols-[minmax(12rem,1fr)_auto_auto_auto]" scroll={false}>
          <Input
            defaultValue={query.search}
            name="search"
            placeholder="Search cryostorage label, strain, project, location, or notes"
            className="min-w-0"
            data-testid="cryostorage-search"
          />
          <select
            defaultValue={query.status}
            name="status"
            className="h-11 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] md:w-auto"
            aria-label="Filter cryostorage by status"
          >
            <option value="all">All statuses</option>
            <option value="stored">Stored</option>
            <option value="reserved">Reserved</option>
            <option value="recovered">Recovered</option>
            <option value="depleted">Depleted</option>
            <option value="discarded">Discarded</option>
          </select>
          <select
            defaultValue={query.strainId}
            name="strainId"
            className="h-11 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] md:w-auto"
            aria-label="Filter cryostorage by strain"
          >
            <option value="all">All strains</option>
            {strainOptions.map((strain) => (
              <option key={strain.id} value={strain.id}>
                {strain.label}
              </option>
            ))}
          </select>
          <input name="pageSize" type="hidden" value={pageSize} />
          <button className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]" data-testid="cryostorage-filter-submit" type="submit">Apply filters</button>
        </Form>
        <div className="count-strip justify-between">
          <span><span className="font-medium text-[var(--ink)]">{totalCount}</span> matching records across the authorized inventory</span>
          {filtersActive ? <Link href="/cryostorage" className="text-sm font-medium text-[var(--accent)] hover:text-[var(--accent-strong)]">Clear filters</Link> : null}
        </div>
      </div>
      <InventoryPagination
        basePath="/cryostorage"
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        query={{ pageSize, search: query.search, status: query.status, strainId: query.strainId }}
        totalCount={totalCount}
      />
      <div className="grid gap-3 md:hidden">
        {table.getRowModel().rows.map((row) => {
          const record = row.original;

          return (
            <article key={record.id} className="mobile-record">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[var(--ink)]">{record.sampleLabel}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{record.materialType}</p>
                  {record.quantityLabel ? (
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">{record.quantityLabel}</p>
                  ) : null}
                </div>
                <div className="action-row justify-end">
                  <Badge variant={statusVariant(record.status)}>{record.status}</Badge>
                  {canManage ? (
                    <RowActionMenu label="Edit">
                      <CryostorageInlineEditForm record={record} />
                    </RowActionMenu>
                  ) : null}
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Stored</dt>
                  <dd className="mt-1 text-[var(--ink)]">{formatDate(record.storedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Project</dt>
                  <dd className="mt-1 text-[var(--ink)]">{record.projectCode ?? "None"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Lab</dt>
                  <dd className="mt-1 text-[var(--ink)]">{record.labLabel}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Strain</dt>
                  <dd className="mt-1 text-[var(--ink)]">{record.strainName}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Location</dt>
                  <dd className="mt-1 text-[var(--muted)]">{record.storageLocation ?? "Pending"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Recovery</dt>
                  <dd className="mt-1 text-[var(--muted)]">{record.recoveryNotes ?? "None"}</dd>
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
          No cryostorage records match the current filters. Clear the search or widen the status and strain filters to review the full backup inventory.
        </div>
      )}
    </div>
  );
}
