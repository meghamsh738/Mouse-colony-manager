"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  addInvoiceAdjustment,
  finalizeInvoice,
  generateLabInvoice,
  upsertCageChargeCategory,
  voidInvoice,
} from "@/lib/billing-write";
import { isSupportedCurrencyCode, parseCurrencyToMinorUnits } from "@/lib/currency";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const rateSchema = z.object({
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
  categoryId: z.string().trim().optional(),
  expectedVersion: z.coerce.number().int().nonnegative(),
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(40),
  dailyRateCents: z.coerce.number().int().min(0),
  currencyCode: z.string().trim().length(3).transform((value) => value.toUpperCase()).refine(isSupportedCurrencyCode).default("USD"),
  active: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
});

const generateInvoiceSchema = z.object({
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
  labId: z.string().trim().min(1),
  periodStart: z.string().trim().min(1),
  periodEnd: z.string().trim().min(1),
});

const invoiceActionSchema = z.object({
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
  invoiceId: z.string().trim().min(1),
  labId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
});

const voidInvoiceActionSchema = z.object({
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
  invoiceId: z.string().trim().min(1),
  labId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
});

const invoiceAdjustmentSchema = z.object({
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
  invoiceId: z.string().trim().min(1),
  labId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  adjustmentType: z.enum(["debit", "credit"]),
  amountCents: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
  reversesAdjustmentId: z.string().trim().optional(),
});

function revalidateBilling(invoiceId?: string) {
  revalidatePath("/");
  revalidatePath("/cages");
  revalidatePath("/billing");
  revalidatePath("/billing/rates");
  revalidatePath("/billing/invoices");
  revalidatePath("/notifications");

  if (invoiceId) {
    revalidatePath(`/billing/invoices/${invoiceId}`);
  }
}

export async function upsertCageRateAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "billing:manage" });
  const parsed = rateSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    categoryId: formData.get("categoryId") || undefined,
    expectedVersion: formData.get("expectedVersion"),
    name: formData.get("name"),
    code: formData.get("code"),
    dailyRateCents: parseCurrencyToMinorUnits(formData.get("dailyRate"), formData.get("dailyRateCents")),
    currencyCode: formData.get("currencyCode") || "USD",
    active: formData.get("active") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a rate name, code, currency, and daily rate.",
    };
  }

  const result = await upsertCageChargeCategory(
    {
      ...parsed.data,
      active: parsed.data.active === "on",
    },
    user,
  );

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidateBilling();

  return {
    status: "success",
    message: result.message,
  };
}

export async function generateInvoiceAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "billing:generate" });
  const parsed = generateInvoiceSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    labId: formData.get("labId"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a lab and date range.",
    };
  }

  const result = await generateLabInvoice(parsed.data, user);

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidateBilling(result.entityId);

  return {
    status: "success",
    message: result.message,
  };
}

export async function finalizeInvoiceAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "billing:finalize" });
  const parsed = invoiceActionSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    invoiceId: formData.get("invoiceId"),
    labId: formData.get("labId"),
    expectedVersion: formData.get("expectedVersion"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Invoice not found.",
    };
  }

  const result = await finalizeInvoice(parsed.data, user);

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidateBilling(parsed.data.invoiceId);

  return {
    status: "success",
    message: result.message,
  };
}

export async function voidInvoiceAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "billing:finalize" });
  const parsed = voidInvoiceActionSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    invoiceId: formData.get("invoiceId"),
    labId: formData.get("labId"),
    expectedVersion: formData.get("expectedVersion"),
    reason: formData.get("reason") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a reason before voiding the invoice.",
    };
  }

  const result = await voidInvoice(parsed.data, user);

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidateBilling(parsed.data.invoiceId);

  return {
    status: "success",
    message: result.message,
  };
}

export async function addInvoiceAdjustmentAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "billing:finalize" });
  const amountCents = parseCurrencyToMinorUnits(formData.get("amount"), formData.get("amountCents"));
  const parsed = invoiceAdjustmentSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    invoiceId: formData.get("invoiceId"),
    labId: formData.get("labId"),
    expectedVersion: formData.get("expectedVersion"),
    adjustmentType: formData.get("adjustmentType"),
    amountCents,
    reason: formData.get("reason"),
    reversesAdjustmentId: formData.get("reversesAdjustmentId") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: "Enter a positive debit or credit amount and a reason." };
  }
  const result = await addInvoiceAdjustment(parsed.data, user);
  if (!result.ok) return { status: "error", message: result.message };
  revalidateBilling(parsed.data.invoiceId);
  return { status: "success", message: result.message };
}
