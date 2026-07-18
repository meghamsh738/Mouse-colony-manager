import Link from "next/link";

import { AppShell } from "@/components/app/app-shell";
import { BillingSubnav } from "@/components/app/billing-subnav";
import { InlineSection } from "@/components/app/layout-primitives";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { formatMoney, getInvoiceListView } from "@/lib/billing-read";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export default async function BillingInvoicesPage() {
  const user = await requireUser({ capability: "billing:read" });
  const invoices = await getInvoiceListView(user);
  const activeTotals = new Map<string, number>();
  invoices.forEach((invoice) => {
    if (invoice.status !== "void") {
      activeTotals.set(invoice.currencyCode, (activeTotals.get(invoice.currencyCode) ?? 0) + invoice.totalCents);
    }
  });
  const activeTotalLabel = [...activeTotals]
    .map(([currencyCode, totalCents]) => formatMoney(totalCents, currencyCode))
    .join(" + ");

  return (
    <AppShell currentPath="/billing" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader breadcrumbs={[{ href: "/billing", label: "Billing" }, { label: "Invoices" }]} title="Invoices" />
        <BillingSubnav currentPath="/billing/invoices" />
        <InlineSection
          title="Invoice history"
          meta={
            invoices.length ? (
              <span>
                {invoices.length} {invoices.length === 1 ? "invoice" : "invoices"} · {activeTotalLabel || "No active total"}
              </span>
            ) : undefined
          }
        >
          {invoices.length ? (
            <>
              <div className="data-table-wrap hidden md:block">
                <table className="data-table compact-table min-w-[820px]">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Lab</th>
                      <th>Period</th>
                      <th>Lines</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="wrap-value font-mono text-sm font-semibold">{invoice.invoiceNumber}</td>
                        <td className="wrap-value">{invoice.labCode}</td>
                        <td className="wrap-value text-sm text-[var(--muted)]">
                          {formatDate(invoice.periodStart)} to {formatDate(invoice.periodEnd)}
                        </td>
                        <td>{invoice.lineItemCount}</td>
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
                  {invoices.map((invoice) => (
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
                            <span>·</span>
                            <span>{invoice.lineItemCount} lines</span>
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
              No invoices are available.
            </div>
          )}
        </InlineSection>
      </div>
    </AppShell>
  );
}
