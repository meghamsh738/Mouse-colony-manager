"use client";

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

export function CryostorageTable({ data }: { data: CryostorageInventoryItem[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CryostorageInventoryItem["status"]>("all");
  const [strainFilter, setStrainFilter] = useState("all");

  const strainNames = useMemo(
    () => Array.from(new Set(data.map((record) => record.strainName))).sort((left, right) => left.localeCompare(right)),
    [data],
  );

  const filteredData = useMemo(
    () =>
      data.filter((record) => {
        const haystack = [
          record.sampleLabel,
          record.materialType,
          record.strainName,
          record.projectCode ?? "",
          record.storageLocation ?? "",
          record.quantityLabel ?? "",
          record.recoveryNotes ?? "",
          record.notes ?? "",
        ]
          .join(" ")
          .toLowerCase();

        const matchesSearch = haystack.includes(search.toLowerCase());
        const matchesStatus = statusFilter === "all" ? true : record.status === statusFilter;
        const matchesStrain = strainFilter === "all" ? true : record.strainName === strainFilter;

        return matchesSearch && matchesStatus && matchesStrain;
      }),
    [data, search, statusFilter, strainFilter],
  );

  const summary = useMemo(
    () =>
      filteredData.reduce(
        (counts, record) => {
          counts.total += 1;
          counts[record.status] += 1;
          return counts;
        },
        {
          total: 0,
          stored: 0,
          reserved: 0,
          recovered: 0,
          depleted: 0,
          discarded: 0,
        },
      ),
    [filteredData],
  );

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
    <div className="space-y-5" data-testid="cryostorage-table">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search cryostorage label, strain, project, location, or notes"
            data-testid="cryostorage-search"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="h-11 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm text-[var(--ink)]"
          >
            <option value="all">All statuses</option>
            <option value="stored">Stored</option>
            <option value="reserved">Reserved</option>
            <option value="recovered">Recovered</option>
            <option value="depleted">Depleted</option>
            <option value="discarded">Discarded</option>
          </select>
          <select
            value={strainFilter}
            onChange={(event) => setStrainFilter(event.target.value)}
            className="h-11 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm text-[var(--ink)]"
          >
            <option value="all">All strains</option>
            {strainNames.map((strainName) => (
              <option key={strainName} value={strainName}>
                {strainName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-[24px] border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted)]">
          <span>
            <span className="font-medium text-[var(--ink)]">{summary.total}</span> records
          </span>
          <span>
            <span className="font-medium text-[var(--ink)]">{summary.stored}</span> stored
          </span>
          <span>
            <span className="font-medium text-[var(--ink)]">{summary.reserved}</span> reserved
          </span>
          <span>
            <span className="font-medium text-[var(--ink)]">{summary.recovered}</span> recovered
          </span>
        </div>
      </div>
      <div className="overflow-x-auto rounded-[24px] border border-[var(--line)]">
        <table className="min-w-full border-collapse text-left">
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
          No cryostorage records match the current filters. Clear the search or widen the status and strain filters to review the full backup inventory.
        </div>
      )}
    </div>
  );
}
