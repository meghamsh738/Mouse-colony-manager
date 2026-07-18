"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { moveCageSchema } from "@/lib/cage-move-schema";
import { executeCloseCageCommand } from "@/lib/cage-closure-write";
import { executeSetCageResponsibilityCommand } from "@/lib/cage-responsibility-write";
import { prepareWorkflowReview } from "@/lib/command-foundation";
import { moveCageLocation, updateCageDetails } from "@/lib/colony-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { canManageLab, getActorLabAccess } from "@/lib/lab-access";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const cageDetailSchema = z.object({
  cageId: z.string().trim().min(1),
  barcode: z.string().trim().min(1),
  status: z.enum(["active", "breeding", "quarantine", "experiment", "retired"]),
  notes: z.string().trim().max(1000).optional(),
  welfareFlags: z.string().trim().max(400).optional(),
  chargeCategoryId: z.string().trim().optional(),
  dailyRateCents: z.coerce.number().int().min(0).optional(),
});

const cageResponsibilitySchema = z.object({
  cageId: z.string().trim().min(1),
  labId: z.string().trim().min(1),
  barcode: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
});

const exitMoveSchema = z.object({
  animalId: z.string().trim().min(1),
  toCageId: z.string().trim().min(1),
});

const exitCageSchema = z.object({
  cageId: z.string().trim().min(1),
  barcode: z.string().trim().min(1),
  closedAt: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(500),
  confirmCloseImpact: z.literal("on"),
  expectedVersion: z.coerce.number().int().positive(),
  idempotencyKey: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
  workflowDraftId: z.string().trim().min(1),
  expectedChargePeriodId: z.string().trim().min(1),
  expectedChargeCategoryId: z.string().trim().min(1),
  expectedChargePeriodStartedAt: z.string().trim().datetime(),
  expectedDailyRateCents: z.coerce.number().int().min(0),
  expectedCurrencyCode: z.string().trim().length(3),
});

function parseOptionalDailyRateCents(value: FormDataEntryValue | null, fallback: FormDataEntryValue | null) {
  const rawValue = value?.toString().trim();

  if (rawValue) {
    const normalizedValue = rawValue.replaceAll(/[$,\s]/g, "");
    const dollars = Number(normalizedValue);

    return Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : Number.NaN;
  }

  const fallbackValue = fallback?.toString().trim();

  if (!fallbackValue) {
    return undefined;
  }

  return Number(fallbackValue);
}

function revalidateCageWorkflow(cageId: string, barcode: string) {
  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/cages");
  revalidatePath(`/cages/${cageId}`);
  revalidatePath(`/scan/${barcode}`);
  revalidatePath("/cages/labels");
  revalidatePath("/billing");
  revalidatePath("/billing/invoices");
  revalidatePath("/workbook");
  revalidatePath("/forecast");
}

export async function updateCageResponsibilityAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "cages:manage" });
  const parsed = cageResponsibilitySchema.safeParse({
    cageId: formData.get("cageId"),
    labId: formData.get("labId"),
    barcode: formData.get("barcode"),
    expectedVersion: formData.get("expectedVersion"),
    reason: formData.get("reason"),
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Choose responsible lab members and enter a reason." };
  }

  const result = await executeSetCageResponsibilityCommand({
    actor: user,
    command: {
      cageId: parsed.data.cageId,
      labId: parsed.data.labId,
      responsibleUserIds: formData.getAll("responsibleUserId").map((value) => value.toString()),
      reason: parsed.data.reason,
    },
    expectedVersion: parsed.data.expectedVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });
  if (!result.ok) {
    return { status: "error", message: result.message ?? "Cage responsibility could not be saved." };
  }

  revalidateCageWorkflow(parsed.data.cageId, parsed.data.barcode);
  const saved = result.result as { message?: string };
  return { status: "success", message: saved.message ?? "Cage responsibility saved." };
}

export async function moveCageAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "cages:manage" });
  const parsed = moveCageSchema.safeParse({
    cageId: formData.get("cageId"),
    roomId: formData.get("roomId"),
    rackId: formData.get("rackId"),
    cageNumber: formData.get("cageNumber"),
    movedAt: formData.get("movedAt"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a destination room, rack, cage number, move date, and reason.",
    };
  }

  const result = await moveCageLocation(parsed.data, { id: user.id, role: user.role, activeLabId: user.activeLabId });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/cages");
  revalidatePath(`/cages/${parsed.data.cageId}`);

  return {
    status: "success",
    message: result.message,
  };
}

export async function updateCageDetailsAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "cages:manage" });
  const parsed = cageDetailSchema.safeParse({
    cageId: formData.get("cageId"),
    barcode: formData.get("barcode"),
    status: formData.get("status"),
    notes: formData.get("notes") || undefined,
    welfareFlags: formData.get("welfareFlags") || undefined,
    chargeCategoryId: formData.get("chargeCategoryId") || undefined,
    dailyRateCents: parseOptionalDailyRateCents(formData.get("dailyRate"), formData.get("dailyRateCents")),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a status, optional charge category, and valid daily rate.",
    };
  }

  const result = await updateCageDetails(
    {
      cageId: parsed.data.cageId,
      status: parsed.data.status,
      notes: parsed.data.notes ?? "",
      welfareFlags: parsed.data.welfareFlags
        ?.split(",")
        .map((flag) => flag.trim())
        .filter(Boolean),
      chargeCategoryId: parsed.data.chargeCategoryId,
      dailyRateCents: parsed.data.dailyRateCents,
    },
    user,
  );

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidateCageWorkflow(parsed.data.cageId, parsed.data.barcode);

  return {
    status: "success",
    message: result.message,
  };
}

export async function exitCageAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "cages:manage" });
  const parsed = exitCageSchema.safeParse({
    cageId: formData.get("cageId"),
    barcode: formData.get("barcode"),
    closedAt: formData.get("closedAt") ?? formData.get("exitDate"),
    reason: formData.get("reason"),
    confirmCloseImpact: formData.get("confirmCloseImpact"),
    expectedVersion: formData.get("expectedVersion"),
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    workflowDraftId: formData.get("workflowDraftId"),
    expectedChargePeriodId: formData.get("expectedChargePeriodId"),
    expectedChargeCategoryId: formData.get("expectedChargeCategoryId"),
    expectedChargePeriodStartedAt: formData.get("expectedChargePeriodStartedAt"),
    expectedDailyRateCents: formData.get("expectedDailyRateCents"),
    expectedCurrencyCode: formData.get("expectedCurrencyCode"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose an exit date and reason, then confirm the closure impact.",
    };
  }

  const animalIds = formData.getAll("moveAnimalId");
  const toCageIds = formData.getAll("moveToCageId");
  const moves = animalIds.flatMap((animalId, index) => {
    const move = exitMoveSchema.safeParse({
        animalId,
        toCageId: toCageIds[index],
      });

    return move.success ? [move.data] : [];
  });

  const cageScope = await prisma.cage.findUnique({
    where: { id: parsed.data.cageId },
    select: { labId: true },
  });
  const access = await getActorLabAccess(user);
  if (!cageScope || !canManageLab(access, cageScope.labId)) {
    return { status: "error", message: "Cage not found." };
  }

  const command = {
    cageId: parsed.data.cageId,
    labId: cageScope.labId,
    closedAt: parsed.data.closedAt,
    reason: parsed.data.reason,
    expectedChargePeriodId: parsed.data.expectedChargePeriodId,
    expectedChargeCategoryId: parsed.data.expectedChargeCategoryId,
    expectedChargePeriodStartedAt: parsed.data.expectedChargePeriodStartedAt,
    expectedDailyRateCents: parsed.data.expectedDailyRateCents,
    expectedCurrencyCode: parsed.data.expectedCurrencyCode.toUpperCase(),
    assignments: moves,
  };
  const review = await prepareWorkflowReview({
    actor: user,
    draftId: parsed.data.workflowDraftId,
    workflowType: "cage.closure",
    requiredCapability: "cages:manage",
    labId: cageScope.labId,
    payload: { command, expectedVersion: parsed.data.expectedVersion } as unknown as Prisma.InputJsonValue,
    allowCommittedReplay: true,
  });
  if (!review.ok) return { status: "error", message: review.message };
  const result = await executeCloseCageCommand({
    actor: user,
    command,
    expectedVersion: parsed.data.expectedVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
    workflowDraftId: review.draft.id,
    reviewSnapshotId: review.snapshot.id,
  });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidateCageWorkflow(parsed.data.cageId, parsed.data.barcode);

  const saved = result.result as { message?: string };

  return {
    status: "success",
    message: saved.message ?? "Cage closure saved.",
  };
}
