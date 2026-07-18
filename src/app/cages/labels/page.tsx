import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";

import { PrintButton } from "@/components/app/print-button";
import { Badge } from "@/components/ui/badge";
import { getPrintableCageLabelView } from "@/lib/cages-read";
import { requireUser } from "@/lib/session";
import type { CageStatus } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const cageStatuses: Array<CageStatus> = ["active", "breeding", "quarantine", "experiment", "retired", "closed"];

type CageLabelsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getStringParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = searchParams[key];

  return Array.isArray(value) ? value[0] : value;
}

function getStatusFilter(value: string | undefined): "all" | CageStatus {
  return value && cageStatuses.includes(value as CageStatus) ? (value as CageStatus) : "all";
}

export default async function CageLabelsPage({ searchParams }: CageLabelsPageProps) {
  const user = await requireUser({ capability: "cages:read" });
  const resolvedSearchParams = (await searchParams) ?? {};
  const filters = {
    cageId: getStringParam(resolvedSearchParams, "cageId"),
    search: getStringParam(resolvedSearchParams, "search"),
    status: getStatusFilter(getStringParam(resolvedSearchParams, "status")),
    warningsOnly: getStringParam(resolvedSearchParams, "warningsOnly") === "true",
  };
  const view = await getPrintableCageLabelView(filters, user);
  const labels = await Promise.all(
    view.labels.map(async (label) => ({
      ...label,
      qrCode: await QRCode.toDataURL(label.barcode, {
        width: 220,
        margin: 1,
        color: {
          dark: "#142620",
          light: "#ffffff",
        },
      }),
    })),
  );

  return (
    <main className="cage-label-screen min-h-screen px-4 py-8 sm:px-6 lg:px-10">
      <section className="print-hide mx-auto mb-6 max-w-6xl rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_18px_55px_rgba(20,38,32,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--accent)]">Cages &gt; Labels</p>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Labels</p>
            <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)]">Cage QR labels</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex h-11 items-center justify-center rounded-full border border-[var(--line)] bg-white/60 px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-white"
              href="/cages"
            >
              Back to cages
            </Link>
            <PrintButton label="Print" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-sm text-[var(--muted)]">
          <Badge variant="neutral">{labels.length} of {view.total}</Badge>
          <Badge variant="neutral">{formatDate(view.printedAt)}</Badge>
          {filters.search ? <Badge variant="neutral">Search {filters.search}</Badge> : null}
          {filters.status !== "all" ? <Badge variant="neutral">Status {filters.status}</Badge> : null}
          {filters.warningsOnly ? <Badge variant="warning">Warnings only</Badge> : null}
        </div>
      </section>

      {labels.length ? (
        <section className="cage-label-sheet mx-auto grid max-w-6xl justify-center gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {labels.map((label) => (
            <article
              className="cage-print-label wrap-value w-full max-w-[22rem] rounded-2xl border border-[var(--line-strong)] bg-white p-4 shadow-[0_12px_34px_rgba(20,38,32,0.08)]"
              data-testid="cage-print-label"
              key={label.id}
            >
              <div className="grid grid-cols-[6.25rem_minmax(0,1fr)] gap-4">
                <Image alt={`QR code for ${label.barcode}`} height={96} src={label.qrCode} unoptimized width={96} />
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Cage barcode</p>
                  <p className="mt-1 break-words font-mono text-xl font-semibold tracking-[0.04em] text-[var(--ink)]">
                    {label.barcode}
                  </p>
                  <p className="mt-2 font-semibold text-[var(--ink)]">{label.locationLabel}</p>
                  <p className="mt-1 text-sm capitalize text-[var(--muted)]">{label.status}</p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">Occupants</dt>
                  <dd className="mt-1 font-semibold">{label.occupantCount}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">Sex mix</dt>
                  <dd className="mt-1 font-semibold">{label.sexComposition}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">Strain</dt>
                  <dd className="wrap-value mt-1 leading-6">
                    {label.strainSummary}
                  </dd>
                </div>
                <div className="col-span-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                    Warnings {label.warningCount}
                  </span>
                  <span className="text-xs text-[var(--muted)]">{formatDate(view.printedAt)}</span>
                </div>
              </dl>
            </article>
          ))}
        </section>
      ) : (
        <section className="print-hide mx-auto max-w-3xl rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">
          No cage labels match the current print filters.
        </section>
      )}
    </main>
  );
}
