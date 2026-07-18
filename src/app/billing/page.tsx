import Link from "next/link";

import { generateInvoiceAction } from "@/app/billing/actions";
import { AppShell } from "@/components/app/app-shell";
import { BillingSubnav } from "@/components/app/billing-subnav";
import { InvoiceGenerateForm } from "@/components/app/billing-forms";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { InlineSection } from "@/components/app/layout-primitives";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { getBillingDashboardView, formatMoney } from "@/lib/billing-read";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export default async function BillingPage() {
  const user = await requireUser({ capability: "billing:read" });
  const view = await getBillingDashboardView(user);
  const activeInvoiceTotalLabel = view.activeInvoiceTotals
    .map((total) => formatMoney(total.totalCents, total.currencyCode))
    .join(" + ");
  const actions: CompactActionItem[] = view.canGenerateInvoices
    ? [
        {
          id: "draft-invoice",
          label: "Generate draft",
          description: "Choose a lab and service period",
          tone: "primary",
          panel: <InvoiceGenerateForm action={generateInvoiceAction} labs={view.labs} />,
        },
      ]
    : [];

  return (
    <AppShell currentPath="/billing" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader breadcrumbs={[{ label: "Billing" }]} title="Billing" />
        <BillingSubnav currentPath="/billing" />
        {actions.length ? (
          <CompactActionTray
            actions={actions}
            eyebrow="Actions"
            title="Invoice actions"
          />
        ) : null}
        <InlineSection
          title="Recent invoices"
          meta={
            view.invoices.length ? (
              <span>
                {view.invoices.length} {view.invoices.length === 1 ? "invoice" : "invoices"} ·{" "}
                {activeInvoiceTotalLabel || "No active total"}
              </span>
            ) : undefined
          }
        >
          {view.invoices.length ? (
            <>
              <div className="data-table-wrap hidden md:block">
                <table className="data-table compact-table min-w-[760px]">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Lab</th>
                      <th>Period</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="wrap-value font-mono text-sm font-semibold">{invoice.invoiceNumber}</td>
                        <td className="wrap-value">{invoice.labCode}</td>
                        <td className="wrap-value text-sm text-[var(--muted)]">
                          {formatDate(invoice.periodStart)} to {formatDate(invoice.periodEnd)}
                        </td>
                        <td>
                          <Badge variant={invoice.status === "void" ? "danger" : invoice.status === "draft" ? "warning" : "success"}>
                            {invoice.status}
                          </Badge>
                        </td>
                        <td className="money text-right font-semibold">{formatMoney(invoice.totalCents, invoice.currencyCode)}</td>
                        <td>
                          <Link aria-label={`Open invoice ${invoice.invoiceNumber}`} className="table-action" href={`/billing/invoices/${invoice.id}`}>
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden">
                <div className="row-list">
                  {view.invoices.map((invoice) => (
                    <article className="record-row" key={invoice.id}>
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="wrap-value font-mono text-sm font-semibold">{invoice.invoiceNumber}</p>
                          <p className="metadata-line mt-1">
                            <span>{invoice.labCode}</span>
                            <span>·</span>
                            <Badge variant={invoice.status === "void" ? "danger" : invoice.status === "draft" ? "warning" : "success"}>
                              {invoice.status}
                            </Badge>
                          </p>
                        </div>
                        <p className="money font-semibold">{formatMoney(invoice.totalCents, invoice.currencyCode)}</p>
                      </div>
                      <p className="wrap-value text-sm text-[var(--muted)]">
                        {formatDate(invoice.periodStart)} to {formatDate(invoice.periodEnd)}
                      </p>
                      <Link aria-label={`Open invoice ${invoice.invoiceNumber}`} className="action-chip justify-self-start" href={`/billing/invoices/${invoice.id}`}>
                        Open
                      </Link>
                    </article>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--line)] bg-white/60 p-6 text-sm text-[var(--muted)]">
              No recent invoices are available.
            </div>
          )}
        </InlineSection>
        <InlineSection title="Active cage charges" meta={<span>{view.activeChargePeriods.length} open periods</span>}>
          {view.activeChargePeriods.length ? (
            <div className="row-list">
              {view.activeChargePeriods.map((period) => (
                <article className="record-row" key={period.id}>
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link className="wrap-value font-mono text-sm font-semibold hover:underline" href={`/cages/${period.cageId}`}>
                        {period.facilityCageId} · {period.cageBarcode}
                      </Link>
                      <p className="metadata-line mt-1">
                        <span>{period.labCode}</span><span>·</span><span>{period.cageLocation}</span>
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {period.categoryName} · since {formatDate(period.startedAt)}
                      </p>
                    </div>
                    <p className="money font-semibold">{formatMoney(period.dailyRateCents, period.currencyCode)}/day</p>
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="text-sm text-[var(--muted)]">No active cage charge periods.</p>}
        </InlineSection>
        <InlineSection title="Lab rates">
          <div className="data-table-wrap hidden md:block">
            <table className="data-table compact-table min-w-[560px]">
              <thead>
                <tr>
                  <th>Lab</th>
                  <th>Code</th>
                  <th>Active cage rate</th>
                </tr>
              </thead>
              <tbody>
                {view.labs.map((lab) => (
                  <tr key={lab.id}>
                    <td className="wrap-value font-medium">{lab.name}</td>
                    <td className="font-mono text-xs text-[var(--muted)]">{lab.code}</td>
                    <td className="text-right">
                      {lab.activeDailyRates.length ? (
                        <span className="inline-flex flex-col items-end gap-1">
                          {lab.activeDailyRates.map((rate) => (
                            <span className="money font-semibold" key={rate.currencyCode}>
                              {formatMoney(rate.totalCents, rate.currencyCode)}/day
                            </span>
                          ))}
                        </span>
                      ) : <span className="text-[var(--muted)]">None</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden">
            <div className="row-list">
              {view.labs.map((lab) => (
                <article className="record-row" key={lab.id}>
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="wrap-value font-medium">{lab.name}</p>
                      <p className="font-mono text-xs text-[var(--muted)]">{lab.code}</p>
                    </div>
                    {lab.activeDailyRates.length ? (
                      <div className="flex flex-col items-end gap-1">
                        {lab.activeDailyRates.map((rate) => (
                          <p className="money font-semibold" key={rate.currencyCode}>
                            {formatMoney(rate.totalCents, rate.currencyCode)}/day
                          </p>
                        ))}
                      </div>
                    ) : <p className="text-sm text-[var(--muted)]">No active rate</p>}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </InlineSection>
      </div>
    </AppShell>
  );
}
