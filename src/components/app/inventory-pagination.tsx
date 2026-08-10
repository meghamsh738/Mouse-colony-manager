import Link from "next/link";

type InventoryPaginationProps = {
  basePath: string;
  page: number;
  pageCount: number;
  pageSize: number;
  query?: Record<string, string | number | boolean | null | undefined>;
  totalCount: number;
};

function pageHref(
  basePath: string,
  page: number,
  query: InventoryPaginationProps["query"] = {},
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false || value === "all") continue;
    params.set(key, String(value));
  }

  if (page > 1) params.set("page", String(page));
  const serialized = params.toString();
  return serialized ? `${basePath}?${serialized}` : basePath;
}

const linkClassName = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page)]";

export function InventoryPagination({
  basePath,
  page,
  pageCount,
  pageSize,
  query,
  totalCount,
}: InventoryPaginationProps) {
  const firstRecord = totalCount ? (page - 1) * pageSize + 1 : 0;
  const lastRecord = Math.min(page * pageSize, totalCount);

  return (
    <nav aria-label="Inventory pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
      <p className="text-sm text-[var(--muted)]">
        Showing <span className="font-medium text-[var(--ink)]">{firstRecord}–{lastRecord}</span> of{" "}
        <span className="font-medium text-[var(--ink)]">{totalCount}</span> records
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={linkClassName} href={pageHref(basePath, page - 1, query)} prefetch={false} rel="prev">
            Previous
          </Link>
        ) : (
          <span aria-disabled="true" className={`${linkClassName} cursor-not-allowed opacity-50`}>
            Previous
          </span>
        )}
        <span className="px-2 text-sm text-[var(--muted)]" data-testid="inventory-page-status">
          Page {page} of {pageCount}
        </span>
        {page < pageCount ? (
          <Link className={linkClassName} href={pageHref(basePath, page + 1, query)} prefetch={false} rel="next">
            Next
          </Link>
        ) : (
          <span aria-disabled="true" className={`${linkClassName} cursor-not-allowed opacity-50`}>
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
