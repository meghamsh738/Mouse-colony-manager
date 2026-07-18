import { actorHasCapability, normalizeUserRole, type Capability } from "@/lib/capabilities";
import { formatMinorCurrency } from "@/lib/currency";
import { getActorLabAccess, type ActorLabAccess, type LabActor } from "@/lib/lab-access";
import { prisma } from "@/lib/prisma";

type BillingActor = LabActor & { capabilities?: readonly Capability[] };

export function formatMoney(cents: number, currencyCode = "USD") {
  return formatMinorCurrency(cents, currencyCode);
}

async function getVisibleLabWhere(actor: BillingActor) {
  const access = await getActorLabAccess(actor);

  return {
    access,
    labWhere: access.canViewAll ? {} : { id: { in: access.memberLabIds } },
  };
}

function hasBillingCapability(actor: BillingActor, capability: Capability) {
  if (actor.capabilities) {
    return actor.capabilities.includes(capability);
  }

  return actorHasCapability(
    { canonicalRole: normalizeUserRole(actor.role), activeMembership: null },
    capability,
  );
}

function getVisibleCategoryWhere(access: ActorLabAccess) {
  return access.canViewAll
    ? {}
    : { chargePeriods: { some: { labId: { in: access.memberLabIds } } } };
}

export async function getBillingDashboardView(actor: BillingActor) {
  const { access, labWhere } = await getVisibleLabWhere(actor);
  const [labs, categories, invoices, openPeriods, invoiceTotals] = await Promise.all([
    prisma.lab.findMany({
      where: {
        active: true,
        ...labWhere,
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
      },
    }),
    prisma.cageChargeCategory.findMany({
      where: getVisibleCategoryWhere(access),
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        dailyRateCents: true,
        currencyCode: true,
        active: true,
      },
    }),
    prisma.invoice.findMany({
      where: {
        lab: {
          active: true,
          ...labWhere,
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 8,
      include: {
        lab: {
          select: {
            name: true,
            code: true,
          },
        },
      },
    }),
    prisma.cageChargePeriod.findMany({
      where: {
        endedAt: null,
        lab: {
          active: true,
          ...labWhere,
        },
      },
      select: {
        id: true,
        dailyRateCents: true,
        currencyCode: true,
        labId: true,
        startedAt: true,
        category: { select: { name: true, code: true } },
        lab: { select: { name: true, code: true } },
        cage: {
          select: {
            id: true,
            facilityCageId: true,
            barcode: true,
            cageNumber: true,
            room: { select: { roomNumber: true } },
            rack: { select: { rackNumber: true } },
          },
        },
      },
    }),
    prisma.invoice.groupBy({
      by: ["currencyCode"],
      where: {
        status: { not: "void" },
        lab: {
          active: true,
          ...labWhere,
        },
      },
      _sum: { totalCents: true },
    }),
  ]);

  const dailyRatesByLabId = new Map<string, Map<string, number>>();

  openPeriods.forEach((period) => {
    const labRates = dailyRatesByLabId.get(period.labId) ?? new Map<string, number>();
    labRates.set(period.currencyCode, (labRates.get(period.currencyCode) ?? 0) + period.dailyRateCents);
    dailyRatesByLabId.set(period.labId, labRates);
  });

  return {
    canGenerateInvoices: hasBillingCapability(actor, "billing:generate"),
    canManageRates: hasBillingCapability(actor, "billing:manage"),
    canFinalizeInvoices: hasBillingCapability(actor, "billing:finalize"),
    labs: labs.map((lab) => ({
      ...lab,
      activeDailyRates: [...(dailyRatesByLabId.get(lab.id) ?? new Map<string, number>())]
        .map(([currencyCode, totalCents]) => ({ currencyCode, totalCents })),
    })),
    categories,
    activeInvoiceTotals: invoiceTotals.map((total) => ({
      currencyCode: total.currencyCode,
      totalCents: total._sum.totalCents ?? 0,
    })),
    activeChargePeriods: openPeriods.map((period) => ({
      id: period.id,
      labId: period.labId,
      labName: period.lab.name,
      labCode: period.lab.code,
      cageId: period.cage.id,
      facilityCageId: period.cage.facilityCageId,
      cageBarcode: period.cage.barcode,
      cageLocation: `${period.cage.room.roomNumber} / ${period.cage.rack.rackNumber} / ${period.cage.cageNumber}`,
      categoryName: period.category.name,
      categoryCode: period.category.code,
      dailyRateCents: period.dailyRateCents,
      currencyCode: period.currencyCode,
      startedAt: period.startedAt.toISOString(),
    })),
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.finalNumber ?? invoice.invoiceNumber,
      draftNumber: invoice.invoiceNumber,
      labName: invoice.lab.name,
      labCode: invoice.lab.code,
      status: invoice.status,
      periodStart: invoice.periodStart.toISOString(),
      periodEnd: invoice.periodEnd.toISOString(),
      subtotalCents: invoice.subtotalCents,
      adjustmentTotalCents: invoice.adjustmentTotalCents,
      totalCents: invoice.totalCents,
      currencyCode: invoice.currencyCode,
    })),
  };
}

export async function getBillingRatesView(actor: BillingActor) {
  const access = await getActorLabAccess(actor);
  const categories = await prisma.cageChargeCategory.findMany({
    where: getVisibleCategoryWhere(access),
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return {
    canManageRates: hasBillingCapability(actor, "billing:manage"),
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      code: category.code,
      dailyRateCents: category.dailyRateCents,
      currencyCode: category.currencyCode,
      active: category.active,
      notes: category.notes ?? "",
      version: category.version,
    })),
  };
}

export async function getInvoiceListView(actor: BillingActor) {
  const { labWhere } = await getVisibleLabWhere(actor);
  const invoices = await prisma.invoice.findMany({
    where: {
      lab: {
        active: true,
        ...labWhere,
      },
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      lab: {
        select: {
          name: true,
          code: true,
        },
      },
      lineItems: {
        select: {
          id: true,
        },
      },
    },
  });

  return invoices.map((invoice) => ({
    id: invoice.id,
    invoiceNumber: invoice.finalNumber ?? invoice.invoiceNumber,
    draftNumber: invoice.invoiceNumber,
    labName: invoice.lab.name,
    labCode: invoice.lab.code,
    status: invoice.status,
    periodStart: invoice.periodStart.toISOString(),
    periodEnd: invoice.periodEnd.toISOString(),
    subtotalCents: invoice.subtotalCents,
    adjustmentTotalCents: invoice.adjustmentTotalCents,
    totalCents: invoice.totalCents,
    currencyCode: invoice.currencyCode,
    lineItemCount: invoice.lineItems.length,
  }));
}

export async function getInvoiceDetailView(invoiceId: string, actor: BillingActor) {
  const { labWhere } = await getVisibleLabWhere(actor);
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      lab: { active: true, ...labWhere },
    },
    include: {
      lab: {
        select: {
          id: true,
          name: true,
          code: true,
          billingContact: true,
        },
      },
      lineItems: {
        orderBy: [{ serviceStart: "asc" }, { description: "asc" }],
        include: {
          cage: {
            select: {
              id: true,
              facilityCageId: true,
              barcode: true,
              room: { select: { roomNumber: true } },
              rack: { select: { rackNumber: true } },
              cageNumber: true,
            },
          },
          category: {
            select: {
              name: true,
              code: true,
              currencyCode: true,
            },
          },
          chargePeriod: {
            select: {
              id: true,
              startedAt: true,
              endedAt: true,
              dailyRateCents: true,
              currencyCode: true,
            },
          },
        },
      },
      adjustments: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          createdBy: { select: { name: true, email: true } },
          reversesAdjustment: { select: { id: true } },
          reversedByAdjustment: { select: { id: true } },
        },
      },
      finalizedBy: {
        select: {
          name: true,
          email: true,
        },
      },
      voidedBy: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });

  if (!invoice) {
    return null;
  }

  return {
    id: invoice.id,
    invoiceNumber: invoice.finalNumber ?? invoice.invoiceNumber,
    draftNumber: invoice.invoiceNumber,
    finalNumber: invoice.finalNumber,
    version: invoice.version,
    lab: invoice.lab,
    status: invoice.status,
    periodStart: invoice.periodStart.toISOString(),
    periodEnd: invoice.periodEnd.toISOString(),
    currencyCode: invoice.currencyCode,
    subtotalCents: invoice.subtotalCents,
    adjustmentTotalCents: invoice.adjustmentTotalCents,
    totalCents: invoice.totalCents,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
    finalizedAt: invoice.finalizedAt?.toISOString() ?? null,
    finalizedBy: invoice.finalizedBy?.name ?? invoice.finalizedBy?.email ?? null,
    voidedAt: invoice.voidedAt?.toISOString() ?? null,
    voidedBy: invoice.voidedBy?.name ?? invoice.voidedBy?.email ?? null,
    voidReason: invoice.voidReason ?? null,
    canFinalize: hasBillingCapability(actor, "billing:finalize"),
    adjustments: invoice.adjustments.map((adjustment) => ({
      id: adjustment.id,
      adjustmentType: adjustment.adjustmentType,
      amountCents: adjustment.amountCents,
      signedAmountCents: adjustment.adjustmentType === "debit" ? adjustment.amountCents : -adjustment.amountCents,
      reason: adjustment.reason,
      createdAt: adjustment.createdAt.toISOString(),
      createdBy: adjustment.createdBy.name || adjustment.createdBy.email,
      reversesAdjustmentId: adjustment.reversesAdjustment?.id ?? null,
      reversedByAdjustmentId: adjustment.reversedByAdjustment?.id ?? null,
    })),
    lineItems: invoice.lineItems.map((lineItem) => ({
      id: lineItem.id,
      cageId: lineItem.cage.id,
      facilityCageId: lineItem.cage.facilityCageId,
      cageBarcode: lineItem.cage.barcode,
      chargePeriodId: lineItem.chargePeriod.id,
      cageLocation: `${lineItem.cage.room.roomNumber} / ${lineItem.cage.rack.rackNumber} / ${lineItem.cage.cageNumber}`,
      categoryName: invoice.status === "draft" ? lineItem.category.name : lineItem.description,
      categoryCode: invoice.status === "draft" ? lineItem.category.code : null,
      description: lineItem.description,
      serviceStart: lineItem.serviceStart.toISOString(),
      serviceEnd: lineItem.serviceEnd.toISOString(),
      chargePeriodStart: lineItem.chargePeriod.startedAt.toISOString(),
      chargePeriodEnd: lineItem.chargePeriod.endedAt?.toISOString() ?? null,
      dayCount: lineItem.dayCount,
      dailyRateCents: lineItem.dailyRateCents,
      rateSnapshotLabel: `${invoice.status === "draft" ? lineItem.category.code : lineItem.description} · ${formatMoney(
        lineItem.dailyRateCents,
        lineItem.chargePeriod.currencyCode,
      )}/day`,
      amountCents: lineItem.amountCents,
    })),
  };
}
