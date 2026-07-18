import Link from "next/link";
import { notFound } from "next/navigation";

import { addInvoiceAdjustmentAction, finalizeInvoiceAction, voidInvoiceAction } from "@/app/billing/actions";
import { AppShell } from "@/components/app/app-shell";
import { InvoiceActionForms } from "@/components/app/billing-forms";
import { HighImpactWorkflowShell } from "@/components/app/high-impact-workflow-shell";
import { ContextBand, InlineSection } from "@/components/app/layout-primitives";
import { PageHeader } from "@/components/app/page-header";
import { PrintButton } from "@/components/app/print-button";
import { Surface } from "@/components/app/surface";
import { MobileWorksheetCard } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { formatMoney, getInvoiceDetailView } from "@/lib/billing-read";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

function LineField({ label, value, wide = false }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "mobile-worksheet-field mobile-worksheet-field-wide" : "mobile-worksheet-field"}>
      <dt className="mobile-worksheet-label">{label}</dt>
      <dd className="mobile-worksheet-value">{value}</dd>
    </div>
  );
}

export default async function BillingInvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams?: Promise<{ action?: string }>;
}) {
  const user = await requireUser({ capability: "billing:read" });
  const { invoiceId } = await params;
  const invoice = await getInvoiceDetailView(invoiceId, user);

  if (!invoice) {
    notFound();
  }

  const requestedAction = (await searchParams)?.action;
  const actionMode = requestedAction === "finalize" || requestedAction === "void" ? requestedAction : null;
  if (actionMode && !invoice.canFinalize) notFound();

  if (actionMode) {
    const totalLabel = formatMoney(invoice.totalCents, invoice.currencyCode);
    return (
      <AppShell currentPath="/billing" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
        <HighImpactWorkflowShell
          backHref={`/billing/invoices/${invoice.id}`}
          backLabel="Invoice detail"
          context={[
            { label: "Invoice", value: invoice.invoiceNumber },
            { label: "Lab", value: `${invoice.lab.code} · ${invoice.lab.name}` },
            { label: "Status", value: invoice.status },
            { label: "Total", value: totalLabel },
          ]}
          description={actionMode === "finalize" ? "Review the locked total and billing impact before finalization." : "Record a reason and review the removal from active billing totals."}
          title={actionMode === "finalize" ? `Finalize ${invoice.invoiceNumber}` : `Void ${invoice.invoiceNumber}`}
        >
          <InvoiceActionForms
            adjustmentAction={addInvoiceAdjustmentAction}
            expectedVersion={invoice.version}
            finalizeAction={finalizeInvoiceAction}
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoiceNumber}
            labId={invoice.lab.id}
            labName={invoice.lab.name}
            mode={actionMode}
            status={invoice.status}
            totalLabel={totalLabel}
            voidAction={voidInvoiceAction}
          />
        </HighImpactWorkflowShell>
      </AppShell>
    );
  }

  return (
    <AppShell currentPath="/billing" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader
          breadcrumbs={[
            { href: "/billing", label: "Billing" },
            { href: "/billing/invoices", label: "Invoices" },
            { label: invoice.invoiceNumber },
          ]}
          title={invoice.invoiceNumber}
          badgeLabel={invoice.status}
        />
        <ContextBand
          title={invoice.invoiceNumber}
          subtitle={`${invoice.lab.name} · ${formatDate(invoice.periodStart)} to ${formatDate(invoice.periodEnd)}`}
          items={[
            { label: "status", value: invoice.status },
            { label: "lines", value: invoice.lineItems.length },
            { label: "total", value: formatMoney(invoice.totalCents, invoice.currencyCode), tone: "warning" },
            { label: "generated", value: formatDate(invoice.createdAt) },
          ]}
          actions={
            <>
              <Link className="action-chip" href="/billing/invoices">
                Back
              </Link>
              <Link className="action-chip" href="/billing">
                Draft invoice
              </Link>
              <PrintButton label="Print" />
            </>
          }
        />
        <div className="space-y-6">
          <div className="min-w-0 space-y-4 xl:order-1">
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">{invoice.lab.code}</p>
                <h2 className="font-display text-2xl font-semibold tracking-[-0.03em] text-[var(--ink)]">
                  {invoice.lab.name}
                </h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {formatDate(invoice.periodStart)} to {formatDate(invoice.periodEnd)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Total</p>
                <p className="money mt-2 text-2xl font-semibold text-[var(--ink)]">
                  {formatMoney(invoice.totalCents, invoice.currencyCode)}
                </p>
              </div>
            </div>
            <div className="identity-band grid gap-3 md:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Status</p>
                <Badge variant={invoice.status === "void" ? "danger" : invoice.status === "draft" ? "warning" : "success"}>
                  {invoice.status}
                </Badge>
              </div>
              {invoice.finalNumber ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Draft reference</p>
                  <p className="mt-1 wrap-value font-mono text-xs">{invoice.draftNumber}</p>
                </div>
              ) : null}
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Service period</p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {formatDate(invoice.periodStart)} to {formatDate(invoice.periodEnd)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Lines</p>
                <p className="mt-1 font-medium">{invoice.lineItems.length}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Calculation</p>
                <p className="mt-1 text-sm text-[var(--muted)]">Each line is days x daily rate.</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Generated</p>
                <p className="mt-1 font-medium">{formatDate(invoice.createdAt)}</p>
              </div>
              <div className="md:col-span-2">
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Rate source</p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Line items show the charge period that supplied each daily rate.
                </p>
              </div>
              {invoice.finalizedAt ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Finalized</p>
                  <p className="mt-1 font-medium">{formatDate(invoice.finalizedAt)}</p>
                  {invoice.finalizedBy ? <p className="mt-1 text-sm text-[var(--muted)]">{invoice.finalizedBy}</p> : null}
                </div>
              ) : null}
              {invoice.voidedAt ? (
                <div className="md:col-span-2">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Voided</p>
                  <p className="mt-1 font-medium">{formatDate(invoice.voidedAt)}</p>
                  {invoice.voidedBy ? <p className="mt-1 text-sm text-[var(--muted)]">{invoice.voidedBy}</p> : null}
                  {invoice.voidReason ? <p className="mt-1 text-sm text-[var(--muted)]">{invoice.voidReason}</p> : null}
                </div>
              ) : null}
            </div>
            <InlineSection title="Line items" meta={<span>days x daily rate = amount</span>}>
            <div className="data-table-wrap hidden md:block">
              <table className="data-table compact-table min-w-[860px]">
                <thead>
                  <tr>
                    <th>Cage</th>
                    <th>Category</th>
                    <th>Service period</th>
                    <th>Days</th>
                    <th>Rate</th>
                    <th>Formula</th>
                    <th>Rate period</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lineItems.map((lineItem) => (
                    <tr key={lineItem.id}>
                      <td className="min-w-[10rem]">
                        <Link className="wrap-value font-mono text-sm font-semibold text-[var(--ink)] underline-offset-4 hover:underline" href={`/cages/${lineItem.cageId}`}>
                          {lineItem.facilityCageId} · {lineItem.cageBarcode}
                        </Link>
                        <p className="mt-1 wrap-value text-xs text-[var(--muted)]">{lineItem.cageLocation}</p>
                        <p className="mt-1 wrap-value font-mono text-[11px] text-[var(--muted)]">Period {lineItem.chargePeriodId}</p>
                      </td>
                      <td className="wrap-value">
                        <p className="font-medium">{lineItem.categoryName}</p>
                        {lineItem.categoryCode ? (
                          <p className="font-mono text-xs text-[var(--muted)]">{lineItem.categoryCode}</p>
                        ) : null}
                      </td>
                      <td className="wrap-value text-sm text-[var(--muted)]">
                        {formatDate(lineItem.serviceStart)} to {formatDate(lineItem.serviceEnd)}
                      </td>
                      <td>{lineItem.dayCount}</td>
                      <td className="money">{formatMoney(lineItem.dailyRateCents, invoice.currencyCode)}/day</td>
                      <td className="wrap-value text-sm">
                        {lineItem.dayCount} days x {formatMoney(lineItem.dailyRateCents, invoice.currencyCode)}/day
                      </td>
                      <td className="wrap-value text-sm text-[var(--muted)]">
                        {formatDate(lineItem.chargePeriodStart)}
                        {lineItem.chargePeriodEnd ? ` to ${formatDate(lineItem.chargePeriodEnd)}` : ""}
                      </td>
                      <td className="money text-right font-semibold">{formatMoney(lineItem.amountCents, invoice.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="worksheet-mobile-list md:hidden">
              {invoice.lineItems.map((lineItem) => (
                <MobileWorksheetCard
                  key={lineItem.id}
                  meta={<span>{lineItem.cageLocation}</span>}
                  title={lineItem.cageBarcode}
                >
                  <dl className="contents">
                    <LineField
                      label="Category"
                      value={lineItem.categoryCode ? `${lineItem.categoryName} · ${lineItem.categoryCode}` : lineItem.categoryName}
                      wide
                    />
                    <LineField
                      label="Service"
                      value={`${formatDate(lineItem.serviceStart)} to ${formatDate(lineItem.serviceEnd)}`}
                      wide
                    />
                    <LineField label="Days" value={lineItem.dayCount} />
                    <LineField
                      label="Daily rate"
                      value={`${formatMoney(lineItem.dailyRateCents, invoice.currencyCode)}/day`}
                    />
                    <LineField
                      label="Formula"
                      value={`${lineItem.dayCount} days x ${formatMoney(lineItem.dailyRateCents, invoice.currencyCode)}/day`}
                      wide
                    />
                    <LineField
                      label="Rate period"
                      value={`${formatDate(lineItem.chargePeriodStart)}${lineItem.chargePeriodEnd ? ` to ${formatDate(lineItem.chargePeriodEnd)}` : ""}`}
                      wide
                    />
                    <LineField
                      label="Amount"
                      value={<span className="money font-semibold">{formatMoney(lineItem.amountCents, invoice.currencyCode)}</span>}
                      wide
                    />
                  </dl>
                </MobileWorksheetCard>
              ))}
            </div>
            </InlineSection>
            <InlineSection title="Adjustments" meta={<span>Append-only billing history</span>}>
              {invoice.adjustments.length ? (
                <div className="row-list">
                  {invoice.adjustments.map((adjustment) => (
                    <article className="record-row" key={adjustment.id}>
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium capitalize">{adjustment.adjustmentType}</p>
                          <p className="wrap-value text-sm text-[var(--muted)]">{adjustment.reason}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {adjustment.createdBy} · {formatDate(adjustment.createdAt)}
                          </p>
                        </div>
                        <p className="money font-semibold">
                          {adjustment.signedAmountCents > 0 ? "+" : ""}
                          {formatMoney(adjustment.signedAmountCents, invoice.currencyCode)}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <p className="text-sm text-[var(--muted)]">No adjustments recorded.</p>}
            </InlineSection>
            <div className="grid gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 sm:ml-auto sm:max-w-md">
              <p className="flex justify-between gap-6 text-sm text-[var(--muted)]">
                <span>Line subtotal</span>
                <span className="money text-[var(--ink)]">{formatMoney(invoice.subtotalCents, invoice.currencyCode)}</span>
              </p>
              <p className="flex justify-between gap-6 text-sm text-[var(--muted)]">
                <span>Adjustments</span>
                <span className="money text-[var(--ink)]">{formatMoney(invoice.adjustmentTotalCents, invoice.currencyCode)}</span>
              </p>
              <p className="flex justify-between gap-6 border-t border-[var(--line)] pt-2 font-semibold">
                <span>Total</span>
                <span className="money text-lg">{formatMoney(invoice.totalCents, invoice.currencyCode)}</span>
              </p>
            </div>
          </div>
          {invoice.canFinalize ? (
            <div className="order-first min-w-0 space-y-6 xl:order-2">
              <Surface className="space-y-4 print-hide" variant="summary">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Actions</p>
                <InvoiceActionForms
                  adjustmentAction={addInvoiceAdjustmentAction}
                  expectedVersion={invoice.version}
                  finalizeAction={finalizeInvoiceAction}
                  invoiceId={invoice.id}
                  invoiceNumber={invoice.invoiceNumber}
                  labId={invoice.lab.id}
                  labName={invoice.lab.name}
                  mode="adjustment"
                  status={invoice.status}
                  totalLabel={formatMoney(invoice.totalCents, invoice.currencyCode)}
                  voidAction={voidInvoiceAction}
                />
                <div className="flex flex-wrap gap-2">
                  {invoice.status === "draft" ? <Link className="action-chip action-chip-primary" href={`/billing/invoices/${invoice.id}?action=finalize`}>Finalize invoice</Link> : null}
                  {invoice.status !== "void" ? <Link className="action-chip action-chip-danger" href={`/billing/invoices/${invoice.id}?action=void`}>Void invoice</Link> : null}
                </div>
              </Surface>
            </div>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
