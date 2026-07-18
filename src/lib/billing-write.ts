import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { actorHasCapability, type Capability } from "@/lib/capabilities";
import { executeIdempotentCommand } from "@/lib/command-foundation";
import { normalizeCurrencyCode } from "@/lib/currency";
import { materializeNotificationAlertInTransaction } from "@/lib/notification-materialization";
import type { ResolvedActor } from "@/lib/session";

type BillingActor = ResolvedActor;

type MutationResult =
  | { ok: true; message: string; entityId?: string; version?: number }
  | { ok: false; message: string };

type CommandIdentity = {
  idempotencyKey: string;
  requestId: string;
};

type UpsertCageChargeCategoryInput = CommandIdentity & {
  categoryId?: string;
  expectedVersion: number;
  name: string;
  code: string;
  dailyRateCents: number;
  currencyCode: string;
  active: boolean;
  notes?: string | null;
};

type GenerateLabInvoiceInput = CommandIdentity & {
  labId: string;
  periodStart: string;
  periodEnd: string;
};

type InvoiceActionInput = CommandIdentity & {
  invoiceId: string;
  labId: string;
  expectedVersion: number;
  reason?: string;
};

type AddInvoiceAdjustmentInput = CommandIdentity & {
  invoiceId: string;
  labId: string;
  expectedVersion: number;
  adjustmentType: "debit" | "credit";
  amountCents: number;
  reason: string;
  reversesAdjustmentId?: string | null;
};

type InvoiceFinancialSnapshot = {
  labId: string;
  periodStart: Date;
  periodEnd: Date;
  currencyCode: string;
  subtotalCents: number;
  adjustmentTotalCents: number;
  totalCents: number;
  adjustments: Array<{ adjustmentType: "debit" | "credit"; amountCents: number }>;
  lineItems: Array<{
    cageId: string;
    categoryId: string;
    serviceStart: Date;
    serviceEnd: Date;
    dayCount: number;
    dailyRateCents: number;
    amountCents: number;
    chargePeriod: {
      cageId: string;
      labId: string;
      categoryId: string;
      dailyRateCents: number;
      currencyCode: string;
      startedAt: Date;
      endedAt: Date | null;
    };
  }>;
};

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseUtcDate(value: string) {
  if (!DATE_ONLY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function nextInvoiceNumber(base: string, existingNumbers: string[]) {
  const reserved = new Set(existingNumbers);
  if (!reserved.has(base)) return base;
  let revision = 2;
  while (reserved.has(`${base}-R${revision}`)) revision += 1;
  return `${base}-R${revision}`;
}

function exactDaysBetween(start: Date, end: Date) {
  const elapsed = end.getTime() - start.getTime();
  if (
    elapsed <= 0
    || elapsed % DAY_MS !== 0
    || start.getUTCHours() !== 0
    || start.getUTCMinutes() !== 0
    || start.getUTCSeconds() !== 0
    || start.getUTCMilliseconds() !== 0
    || end.getUTCHours() !== 0
    || end.getUTCMinutes() !== 0
    || end.getUTCSeconds() !== 0
    || end.getUTCMilliseconds() !== 0
  ) return null;
  return elapsed / DAY_MS;
}

function maxDate(left: Date, right: Date) {
  return left > right ? left : right;
}

function minDate(left: Date, right: Date) {
  return left < right ? left : right;
}

function hasConsistentInvoiceHistory(invoice: InvoiceFinancialSnapshot) {
  if (invoice.periodEnd <= invoice.periodStart) return false;
  const staleLine = invoice.lineItems.some((line) => {
    const period = line.chargePeriod;
    const exactDayCount = exactDaysBetween(line.serviceStart, line.serviceEnd);
    return period.labId !== invoice.labId
      || period.cageId !== line.cageId
      || period.categoryId !== line.categoryId
      || period.dailyRateCents !== line.dailyRateCents
      || period.currencyCode !== invoice.currencyCode
      || line.serviceStart < period.startedAt
      || (period.endedAt !== null && line.serviceEnd > period.endedAt)
      || line.serviceStart < invoice.periodStart
      || line.serviceEnd > invoice.periodEnd
      || exactDayCount === null
      || line.dayCount !== exactDayCount
      || line.dailyRateCents < 0
      || line.amountCents !== line.dayCount * line.dailyRateCents;
  });
  const subtotal = invoice.lineItems.reduce((total, line) => total + line.amountCents, 0);
  const adjustmentTotal = invoice.adjustments.reduce(
    (total, adjustment) => total + (adjustment.adjustmentType === "debit" ? adjustment.amountCents : -adjustment.amountCents),
    0,
  );
  return !staleLine
    && subtotal === invoice.subtotalCents
    && adjustmentTotal === invoice.adjustmentTotalCents
    && invoice.totalCents === subtotal + adjustmentTotal
    && invoice.totalCents >= 0;
}

function hasBillingCapability(actor: BillingActor, capability: Capability) {
  return actor.capabilities.includes(capability) || actorHasCapability(actor, capability);
}

function mutationResult(result: {
  ok: boolean;
  message?: string;
  result?: unknown;
}): MutationResult {
  if (!result.ok) return { ok: false, message: result.message ?? "The billing command could not be completed." };
  const payload = result.result && typeof result.result === "object" && !Array.isArray(result.result)
    ? result.result as Record<string, unknown>
    : null;
  const message = typeof payload?.message === "string" ? payload.message : "Billing was updated.";
  const entityId = typeof payload?.entityId === "string" ? payload.entityId : undefined;
  const version = typeof payload?.version === "number" ? payload.version : undefined;
  return { ok: true, message, entityId, version };
}

async function allocateFinalNumber(tx: Prisma.TransactionClient, finalizedAt: Date) {
  const rows = await tx.$queryRaw<Array<{ sequenceValue: bigint | number }>>(Prisma.sql`
    SELECT nextval('"InvoiceFinalNumber_seq"') AS "sequenceValue"
  `);
  const sequence = rows[0]?.sequenceValue;
  if (sequence === undefined) throw new Error("Invoice final number sequence is unavailable.");
  return `INV-${finalizedAt.getUTCFullYear()}-${String(sequence).padStart(6, "0")}`;
}

async function materializeInvoiceNotification(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    invoiceId: string;
    labId: string;
    eventType: "invoice_finalized" | "invoice_voided";
    invoiceNumber: string;
    occurredAt: Date;
  },
) {
  return materializeNotificationAlertInTransaction(tx, {
    id: `${input.eventType}:${input.invoiceId}`,
    labId: input.labId,
    entityType: "invoice",
    entityId: input.invoiceId,
    alertType: input.eventType,
    severity: "info",
    message: input.eventType === "invoice_finalized"
      ? `${input.invoiceNumber} was finalized.`
      : `${input.invoiceNumber} was voided.`,
    status: "open",
    generatedAt: input.occurredAt.toISOString(),
    source: "billing",
  }, input.actorId);
}

export async function upsertCageChargeCategory(
  input: UpsertCageChargeCategoryInput,
  actor: BillingActor,
): Promise<MutationResult> {
  if (!hasBillingCapability(actor, "billing:manage")) {
    return { ok: false, message: "You do not have permission to manage cage rates." };
  }
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase().replaceAll(/\s+/g, "_");
  const currencyCode = normalizeCurrencyCode(input.currencyCode);
  if (!name || !code || !currencyCode || !Number.isInteger(input.dailyRateCents) || input.dailyRateCents < 0) {
    return { ok: false, message: "Enter a rate name, code, supported ISO currency, and non-negative integer-cent daily rate." };
  }
  if (
    !Number.isInteger(input.expectedVersion)
    || (input.categoryId ? input.expectedVersion < 1 : input.expectedVersion !== 0)
  ) {
    return { ok: false, message: "Refresh the cage rate before saving it." };
  }
  const data = {
    name,
    code,
    dailyRateCents: input.dailyRateCents,
    currencyCode,
    active: input.active,
    notes: input.notes?.trim() || null,
  };
  const result = await executeIdempotentCommand({
    actor,
    commandType: "billing.rate.upsert",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { categoryId: input.categoryId ?? null, expectedVersion: input.expectedVersion, ...data },
    requiredCapability: "billing:manage",
    ...(input.categoryId
      ? {
          aggregateType: "cage_charge_category",
          aggregateId: input.categoryId,
          expectedVersion: input.expectedVersion,
        }
      : {}),
    handler: async (tx) => {
      const previous = input.categoryId
        ? await tx.cageChargeCategory.findUnique({ where: { id: input.categoryId } })
        : null;
      if (input.categoryId && !previous) {
        return { ok: false as const, code: "not_found", message: "Cage rate not found." };
      }
      const duplicateCode = await tx.cageChargeCategory.findFirst({
        where: {
          code,
          ...(input.categoryId ? { NOT: { id: input.categoryId } } : {}),
        },
        select: { id: true },
      });
      if (duplicateCode) {
        return { ok: false as const, code: "duplicate_code", message: "That cage rate code is already in use." };
      }

      let saved;
      if (input.categoryId) {
        const updated = await tx.cageChargeCategory.updateMany({
          where: { id: input.categoryId, version: input.expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (updated.count !== 1) {
          return { ok: false as const, code: "stale_conflict", message: "This cage rate changed after you opened it. Refresh before saving." };
        }
        saved = await tx.cageChargeCategory.findUniqueOrThrow({ where: { id: input.categoryId } });
      } else {
        saved = await tx.cageChargeCategory.create({ data: { id: randomUUID(), ...data } });
      }
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: actor.id,
          entityType: "cage_charge_category",
          entityId: saved.id,
          action: input.categoryId ? "update" : "create",
          previousValue: previous
            ? {
                name: previous.name,
                code: previous.code,
                dailyRateCents: previous.dailyRateCents,
                currencyCode: previous.currencyCode,
                active: previous.active,
                notes: previous.notes,
                version: previous.version,
              }
            : undefined,
          newValue: { ...data, version: saved.version },
          timestamp: new Date(),
        },
      });
      return {
        ok: true as const,
        result: { entityId: saved.id, version: saved.version, message: `${saved.name} was saved.` },
        aggregateType: "cage_charge_category",
        aggregateId: saved.id,
        resultingVersion: saved.version,
      };
    },
  });
  return mutationResult(result);
}

export async function generateLabInvoice(
  input: GenerateLabInvoiceInput,
  actor: BillingActor,
): Promise<MutationResult> {
  if (!hasBillingCapability(actor, "billing:generate")) {
    return { ok: false, message: "You do not have permission to generate invoices." };
  }
  const periodStart = parseUtcDate(input.periodStart);
  const periodEnd = parseUtcDate(input.periodEnd);
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  if (!periodStart || !periodEnd || periodEnd <= periodStart) {
    return { ok: false, message: "Choose a valid UTC invoice date range." };
  }
  if (periodEnd > todayUtc) {
    return { ok: false, message: "Invoice periods must end before today. Choose a completed service period." };
  }

  const result = await executeIdempotentCommand({
    actor,
    commandType: "billing.invoice.generate",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { labId: input.labId, periodStart: input.periodStart, periodEnd: input.periodEnd },
    requiredCapability: "billing:generate",
    labId: input.labId,
    handler: async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Lab" WHERE id = ${input.labId} FOR UPDATE`);
      const lab = await tx.lab.findUnique({
        where: { id: input.labId },
        select: { id: true, name: true, code: true, active: true },
      });
      if (!lab?.active) return { ok: false as const, code: "not_found", message: "Choose an active lab." };

      const overlapping = await tx.invoice.findMany({
        where: {
          labId: lab.id,
          periodStart: { lt: periodEnd },
          periodEnd: { gt: periodStart },
          status: { in: ["draft", "finalized"] },
        },
        orderBy: { id: "asc" },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          periodStart: true,
          periodEnd: true,
          version: true,
          adjustmentTotalCents: true,
        },
      });
      const exact = overlapping.filter((invoice) => (
        invoice.periodStart.getTime() === periodStart.getTime()
        && invoice.periodEnd.getTime() === periodEnd.getTime()
      ));
      const partial = overlapping.find((invoice) => !exact.includes(invoice));
      if (partial || exact.length > 1) {
        const conflict = partial ?? exact[1];
        return {
          ok: false as const,
          code: "billing_period_overlap",
          message: `${conflict.invoiceNumber} already covers part of this date range. Choose a non-overlapping period.`,
        };
      }
      const existing = exact[0] ?? null;
      if (existing?.status === "finalized") {
        return { ok: false as const, code: "terminal_invoice", message: "This invoice is finalized and cannot be regenerated." };
      }

      const chargePeriods = await tx.cageChargePeriod.findMany({
        where: {
          labId: lab.id,
          startedAt: { lt: periodEnd },
          OR: [{ endedAt: null }, { endedAt: { gt: periodStart } }],
        },
        include: {
          cage: {
            select: {
              id: true,
              barcode: true,
              room: { select: { roomNumber: true } },
              rack: { select: { rackNumber: true } },
              cageNumber: true,
            },
          },
          category: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ cage: { barcode: "asc" } }, { startedAt: "asc" }],
      });
      const currencies = new Set(chargePeriods.map((period) => period.currencyCode));
      if (currencies.size > 1) {
        return {
          ok: false as const,
          code: "mixed_currency",
          message: "This billing period contains multiple currencies. Reconcile cage rates before generating one invoice.",
        };
      }

      const lineItems: Array<{
        id: string;
        cageId: string;
        chargePeriodId: string;
        categoryId: string;
        description: string;
        serviceStart: Date;
        serviceEnd: Date;
        dayCount: number;
        dailyRateCents: number;
        amountCents: number;
      }> = [];
      for (const period of chargePeriods) {
        const serviceStart = maxDate(period.startedAt, periodStart);
        const serviceEnd = minDate(period.endedAt ?? periodEnd, periodEnd);
        const dayCount = exactDaysBetween(serviceStart, serviceEnd);
        if (dayCount === null) {
          return {
            ok: false as const,
            code: "fractional_service_day",
            message: `Charge period ${period.cage.barcode} is not aligned to UTC calendar days. Reconcile it before invoicing.`,
          };
        }
        lineItems.push({
          id: randomUUID(),
          cageId: period.cageId,
          chargePeriodId: period.id,
          categoryId: period.categoryId,
          description: `${period.category.name} [${period.category.code}]`,
          serviceStart,
          serviceEnd,
          dayCount,
          dailyRateCents: period.dailyRateCents,
          amountCents: dayCount * period.dailyRateCents,
        });
      }
      const subtotalCents = lineItems.reduce((sum, line) => sum + line.amountCents, 0);
      const adjustmentTotalCents = existing?.adjustmentTotalCents ?? 0;
      const totalCents = subtotalCents + adjustmentTotalCents;
      if (totalCents < 0) {
        return {
          ok: false as const,
          code: "negative_invoice_total",
          message: "Existing credits exceed the regenerated subtotal. Add a corrective debit before regenerating.",
        };
      }
      const currencyCode = chargePeriods[0]?.currencyCode ?? "USD";
      const invoiceId = existing?.id ?? randomUUID();
      const numberBase = `DRAFT-${lab.code}-${dateKey(periodStart)}-${dateKey(periodEnd)}`;
      const existingNumbers = existing ? [] : (await tx.invoice.findMany({
        where: { invoiceNumber: { startsWith: numberBase } },
        select: { invoiceNumber: true },
      })).map((invoice) => invoice.invoiceNumber);
      const invoiceNumber = existing?.invoiceNumber ?? nextInvoiceNumber(numberBase, existingNumbers);
      const version = existing ? existing.version + 1 : 1;

      if (existing) {
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: existing.id } });
        await tx.invoice.update({
          where: { id: existing.id },
          data: { subtotalCents, totalCents, currencyCode, version: { increment: 1 } },
        });
      } else {
        await tx.invoice.create({
          data: {
            id: invoiceId,
            invoiceNumber,
            labId: lab.id,
            status: "draft",
            periodStart,
            periodEnd,
            currencyCode,
            subtotalCents,
            adjustmentTotalCents: 0,
            totalCents,
          },
        });
      }
      if (lineItems.length) {
        await tx.invoiceLineItem.createMany({ data: lineItems.map((line) => ({ ...line, invoiceId })) });
      }
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: actor.id,
          entityType: "invoice",
          entityId: invoiceId,
          action: existing ? "regenerate_draft" : "generate_draft",
          newValue: {
            labId: lab.id,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            subtotalCents,
            adjustmentTotalCents,
            totalCents,
            lineItemCount: lineItems.length,
            version,
          },
          timestamp: new Date(),
        },
      });
      return {
        ok: true as const,
        result: { entityId: invoiceId, version, message: `${invoiceNumber} is ready for review.` },
        aggregateType: "invoice",
        aggregateId: invoiceId,
        resultingVersion: version,
      };
    },
  });
  return mutationResult(result);
}

function invoiceFinancialSelect() {
  return {
    id: true,
    invoiceNumber: true,
    finalNumber: true,
    labId: true,
    status: true,
    version: true,
    periodStart: true,
    periodEnd: true,
    currencyCode: true,
    subtotalCents: true,
    adjustmentTotalCents: true,
    totalCents: true,
    adjustments: { select: { adjustmentType: true, amountCents: true } },
    lineItems: {
      select: {
        cageId: true,
        categoryId: true,
        serviceStart: true,
        serviceEnd: true,
        dayCount: true,
        dailyRateCents: true,
        amountCents: true,
        chargePeriod: {
          select: {
            cageId: true,
            labId: true,
            categoryId: true,
            dailyRateCents: true,
            currencyCode: true,
            startedAt: true,
            endedAt: true,
          },
        },
      },
    },
  } as const;
}

export async function addInvoiceAdjustment(
  input: AddInvoiceAdjustmentInput,
  actor: BillingActor,
): Promise<MutationResult> {
  if (!hasBillingCapability(actor, "billing:finalize")) {
    return { ok: false, message: "You do not have permission to adjust invoices." };
  }
  const reason = input.reason.trim();
  if (
    !reason
    || !["debit", "credit"].includes(input.adjustmentType)
    || !Number.isInteger(input.amountCents)
    || input.amountCents <= 0
    || !Number.isInteger(input.expectedVersion)
    || input.expectedVersion < 1
  ) return { ok: false, message: "Enter a positive integer-cent debit or credit and a reason." };

  const result = await executeIdempotentCommand({
    actor,
    commandType: "billing.invoice.adjust",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: {
      invoiceId: input.invoiceId,
      labId: input.labId,
      adjustmentType: input.adjustmentType,
      amountCents: input.amountCents,
      reason,
      reversesAdjustmentId: input.reversesAdjustmentId ?? null,
    },
    requiredCapability: "billing:finalize",
    labId: input.labId,
    aggregateType: "invoice",
    aggregateId: input.invoiceId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE`);
      const invoice = await tx.invoice.findFirst({
        where: { id: input.invoiceId, labId: input.labId },
        select: { id: true, invoiceNumber: true, status: true, version: true, subtotalCents: true, adjustmentTotalCents: true },
      });
      if (!invoice) return { ok: false as const, code: "not_found", message: "Invoice not found." };
      if (invoice.status !== "draft") {
        return { ok: false as const, code: "terminal_invoice", message: "Only draft invoices can receive adjustments." };
      }
      const signedAmount = input.adjustmentType === "debit" ? input.amountCents : -input.amountCents;
      const adjustmentTotalCents = invoice.adjustmentTotalCents + signedAmount;
      const totalCents = invoice.subtotalCents + adjustmentTotalCents;
      if (totalCents < 0) {
        return { ok: false as const, code: "negative_invoice_total", message: "A credit cannot reduce the invoice below zero." };
      }
      if (input.reversesAdjustmentId) {
        const reversed = await tx.invoiceAdjustment.findFirst({
          where: {
            id: input.reversesAdjustmentId,
            invoiceId: invoice.id,
            labId: input.labId,
            reversesAdjustmentId: null,
          },
          select: { adjustmentType: true, amountCents: true, reversedByAdjustment: { select: { id: true } } },
        });
        if (
          !reversed
          || reversed.reversedByAdjustment
          || reversed.amountCents !== input.amountCents
          || reversed.adjustmentType === input.adjustmentType
        ) {
          return { ok: false as const, code: "invalid_reversal", message: "Choose one unreversed adjustment and offset it exactly." };
        }
      }
      const updated = await tx.invoice.updateMany({
        where: { id: invoice.id, labId: input.labId, status: "draft", version: input.expectedVersion },
        data: { adjustmentTotalCents, totalCents, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        return { ok: false as const, code: "stale_conflict", message: "Invoice changed after review. Refresh it before adjusting." };
      }
      const adjustmentId = randomUUID();
      await tx.invoiceAdjustment.create({
        data: {
          id: adjustmentId,
          invoiceId: invoice.id,
          labId: input.labId,
          adjustmentType: input.adjustmentType,
          amountCents: input.amountCents,
          reason,
          createdById: actor.id,
          reversesAdjustmentId: input.reversesAdjustmentId ?? null,
        },
      });
      const version = input.expectedVersion + 1;
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: actor.id,
          entityType: "invoice_adjustment",
          entityId: adjustmentId,
          action: input.reversesAdjustmentId ? "reverse" : "append",
          newValue: {
            invoiceId: invoice.id,
            labId: input.labId,
            adjustmentType: input.adjustmentType,
            amountCents: input.amountCents,
            reason,
            reversesAdjustmentId: input.reversesAdjustmentId ?? null,
            invoiceVersion: version,
          },
          timestamp: new Date(),
        },
      });
      return {
        ok: true as const,
        result: { entityId: invoice.id, version, message: `${invoice.invoiceNumber} adjustment was recorded.` },
        aggregateType: "invoice",
        aggregateId: invoice.id,
        resultingVersion: version,
      };
    },
  });
  return mutationResult(result);
}

export async function finalizeInvoice(input: InvoiceActionInput, actor: BillingActor): Promise<MutationResult> {
  if (!hasBillingCapability(actor, "billing:finalize")) {
    return { ok: false, message: "You do not have permission to finalize invoices." };
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return { ok: false, message: "Refresh the invoice before finalizing." };
  }
  const result = await executeIdempotentCommand({
    actor,
    commandType: "billing.invoice.finalize",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { invoiceId: input.invoiceId, labId: input.labId },
    requiredCapability: "billing:finalize",
    labId: input.labId,
    aggregateType: "invoice",
    aggregateId: input.invoiceId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE`);
      const invoice = await tx.invoice.findFirst({
        where: { id: input.invoiceId, labId: input.labId },
        select: invoiceFinancialSelect(),
      });
      if (!invoice) return { ok: false as const, code: "not_found", message: "Invoice not found." };
      const targetLab = await tx.lab.findFirst({ where: { id: invoice.labId, active: true }, select: { id: true } });
      if (!targetLab) return { ok: false as const, code: "not_found", message: "Invoice not found." };
      if (invoice.status !== "draft") {
        return { ok: false as const, code: "terminal_invoice", message: "Only draft invoices can be finalized." };
      }
      if (!hasConsistentInvoiceHistory(invoice)) {
        return {
          ok: false as const,
          code: "billing_history_changed",
          message: "Cage charging or adjustments changed after this draft was generated. Regenerate it before finalizing.",
        };
      }
      const finalizedAt = new Date();
      const finalNumber = await allocateFinalNumber(tx, finalizedAt);
      const finalized = await tx.invoice.updateMany({
        where: { id: invoice.id, labId: input.labId, status: "draft", version: input.expectedVersion },
        data: {
          status: "finalized",
          finalNumber,
          finalizedAt,
          finalizedById: actor.id,
          version: { increment: 1 },
        },
      });
      if (finalized.count !== 1) {
        return { ok: false as const, code: "stale_conflict", message: "Invoice changed after review. Refresh it before finalizing." };
      }
      const version = input.expectedVersion + 1;
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: actor.id,
          entityType: "invoice",
          entityId: invoice.id,
          action: "finalize",
          previousValue: { status: invoice.status, version: invoice.version, invoiceNumber: invoice.invoiceNumber },
          newValue: { status: "finalized", version, finalNumber, finalizedAt, totalCents: invoice.totalCents },
          timestamp: finalizedAt,
        },
      });
      await materializeInvoiceNotification(tx, {
        actorId: actor.id,
        invoiceId: invoice.id,
        labId: invoice.labId,
        eventType: "invoice_finalized",
        invoiceNumber: finalNumber,
        occurredAt: finalizedAt,
      });
      return {
        ok: true as const,
        result: { entityId: invoice.id, version, message: `${finalNumber} was finalized.` },
        aggregateType: "invoice",
        aggregateId: invoice.id,
        resultingVersion: version,
      };
    },
  });
  return mutationResult(result);
}

export async function voidInvoice(input: InvoiceActionInput, actor: BillingActor): Promise<MutationResult> {
  if (!hasBillingCapability(actor, "billing:finalize")) {
    return { ok: false, message: "You do not have permission to void invoices." };
  }
  const reason = input.reason?.trim();
  if (!reason) return { ok: false, message: "Enter a reason before voiding the invoice." };
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return { ok: false, message: "Refresh the invoice before voiding." };
  }
  const result = await executeIdempotentCommand({
    actor,
    commandType: "billing.invoice.void",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { invoiceId: input.invoiceId, labId: input.labId, reason },
    requiredCapability: "billing:finalize",
    labId: input.labId,
    aggregateType: "invoice",
    aggregateId: input.invoiceId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE`);
      const invoice = await tx.invoice.findFirst({
        where: { id: input.invoiceId, labId: input.labId },
        select: invoiceFinancialSelect(),
      });
      if (!invoice) return { ok: false as const, code: "not_found", message: "Invoice not found." };
      const targetLab = await tx.lab.findFirst({ where: { id: invoice.labId, active: true }, select: { id: true } });
      if (!targetLab) return { ok: false as const, code: "not_found", message: "Invoice not found." };
      if (invoice.status === "void") {
        return { ok: false as const, code: "terminal_invoice", message: "This invoice is already void." };
      }
      if (!hasConsistentInvoiceHistory(invoice)) {
        return {
          ok: false as const,
          code: "billing_history_changed",
          message: "Invoice charges are inconsistent. Reconcile billing history before voiding.",
        };
      }
      const voidedAt = new Date();
      const voided = await tx.invoice.updateMany({
        where: { id: invoice.id, labId: input.labId, status: invoice.status, version: input.expectedVersion },
        data: {
          status: "void",
          voidedAt,
          voidedById: actor.id,
          voidReason: reason,
          version: { increment: 1 },
        },
      });
      if (voided.count !== 1) {
        return { ok: false as const, code: "stale_conflict", message: "Invoice changed after review. Refresh it before voiding." };
      }
      const version = input.expectedVersion + 1;
      const displayNumber = invoice.finalNumber ?? invoice.invoiceNumber;
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: actor.id,
          entityType: "invoice",
          entityId: invoice.id,
          action: "void",
          previousValue: { status: invoice.status, version: invoice.version },
          newValue: { status: "void", version, voidedAt, reason, totalCents: invoice.totalCents },
          timestamp: voidedAt,
        },
      });
      await materializeInvoiceNotification(tx, {
        actorId: actor.id,
        invoiceId: invoice.id,
        labId: invoice.labId,
        eventType: "invoice_voided",
        invoiceNumber: displayNumber,
        occurredAt: voidedAt,
      });
      return {
        ok: true as const,
        result: { entityId: invoice.id, version, message: `${displayNumber} was voided.` },
        aggregateType: "invoice",
        aggregateId: invoice.id,
        resultingVersion: version,
      };
    },
  });
  return mutationResult(result);
}
