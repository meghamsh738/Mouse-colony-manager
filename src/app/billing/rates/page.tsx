import { upsertCageRateAction } from "@/app/billing/actions";
import { AppShell } from "@/components/app/app-shell";
import { BillingSubnav } from "@/components/app/billing-subnav";
import { RateForm } from "@/components/app/billing-forms";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { PageHeader } from "@/components/app/page-header";
import { MobileWorksheetCard, RowActionMenu, WorksheetShell } from "@/components/app/worksheet-shell";
import { getBillingRatesView, formatMoney } from "@/lib/billing-read";
import { requireUser } from "@/lib/session";

export default async function BillingRatesPage() {
  const user = await requireUser({ capability: "billing:read" });
  const view = await getBillingRatesView(user);
  const actions: CompactActionItem[] = view.canManageRates
    ? [
        {
          id: "add-rate",
          label: "Add rate",
          description: "Cage category",
          tone: "primary",
          panel: <RateForm action={upsertCageRateAction} />,
        },
      ]
    : [];

  return (
    <AppShell currentPath="/billing" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader breadcrumbs={[{ href: "/billing", label: "Billing" }, { label: "Rates" }]} title="Rates" />
        <BillingSubnav currentPath="/billing/rates" />
        {view.canManageRates ? (
          <CompactActionTray
            actions={actions}
            eyebrow="Actions"
            summary={<span>{view.categories.length} cage rate categories</span>}
            title="Rate work"
          />
        ) : null}
        <WorksheetShell>
          <div className="worksheet-table-wrap hidden md:block">
            <table className="worksheet-table min-w-[760px]">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Code</th>
                  <th>Daily rate</th>
                  <th>Currency</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {view.categories.map((category) => (
                  <tr key={category.id}>
                    <td className="worksheet-cell-strong">{category.name}</td>
                    <td className="worksheet-cell-mono">{category.code}</td>
                    <td className="money font-semibold">{formatMoney(category.dailyRateCents, category.currencyCode)}/day</td>
                    <td>{category.currencyCode}</td>
                    <td className="worksheet-cell-muted max-w-[22rem]">{category.notes ?? "None"}</td>
                    <td>
                      {view.canManageRates ? (
                        <RowActionMenu label="Edit">
                          <RateForm action={upsertCageRateAction} category={category} />
                        </RowActionMenu>
                      ) : (
                        <span className="text-sm text-[var(--muted)]">Read only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="worksheet-mobile-list md:hidden">
            {view.categories.map((category) => (
              <MobileWorksheetCard
                actions={
                  view.canManageRates ? (
                    <RowActionMenu label="Edit">
                      <RateForm action={upsertCageRateAction} category={category} />
                    </RowActionMenu>
                  ) : null
                }
                key={category.id}
                meta={
                  <>
                    <span className="font-mono">{category.code}</span>
                    <span>{category.currencyCode}</span>
                  </>
                }
                title={category.name}
              >
                <dl className="contents">
                  <div className="mobile-worksheet-field">
                    <dt className="mobile-worksheet-label">Daily</dt>
                    <dd className="mobile-worksheet-value money font-semibold">
                      {formatMoney(category.dailyRateCents, category.currencyCode)}/day
                    </dd>
                  </div>
                  <div className="mobile-worksheet-field mobile-worksheet-field-wide">
                    <dt className="mobile-worksheet-label">Notes</dt>
                    <dd className="mobile-worksheet-value">{category.notes ?? "None"}</dd>
                  </div>
                </dl>
              </MobileWorksheetCard>
            ))}
          </div>
        </WorksheetShell>
      </div>
    </AppShell>
  );
}
