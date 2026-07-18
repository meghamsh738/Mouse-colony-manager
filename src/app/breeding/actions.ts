"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  executeCreateBreedingSetupCommand,
  executeRecordBreedingLitterCommand,
  executeTransitionBreedingSetupCommand,
  weanLitterToCages,
} from "@/lib/colony-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const createBreedingSchema = z.object({
  sireId: z.string().trim().min(1),
  damId: z.string().trim().min(1),
  startDate: z.string().trim().min(1),
  targetGenotype: z.string().trim().min(3).max(200),
  targetSex: z.enum(["male", "female", "unknown"]).optional(),
  notes: z.string().trim().max(400).optional(),
  allowOverride: z.boolean().optional(),
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
});

const createLitterSchema = z.object({
  breedingSetupId: z.string().trim().min(1),
  birthDate: z.string().trim().min(1),
  litterSizeBirth: z.coerce.number().int().min(1).max(24),
  notes: z.string().trim().max(400).optional(),
  expectedVersion: z.coerce.number().int().min(1),
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
});

const weanLitterSchema = z.object({
  litterId: z.string().trim().min(1),
  weanDate: z.string().trim().min(1),
  femaleCount: z.coerce.number().int().min(0).max(24),
  maleCount: z.coerce.number().int().min(0).max(24),
  femaleCageId: z.string().trim().optional(),
  maleCageId: z.string().trim().optional(),
  strainId: z.string().trim().min(1),
});

const transitionBreedingSchema = z.object({
  breedingSetupId: z.string().trim().min(1),
  targetStatus: z.enum(["active", "paused", "retired", "failed"]),
  happenedAt: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(400),
  expectedVersion: z.coerce.number().int().min(1),
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
});

export async function createBreedingAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "breeding:manage" });
  const parsed = createBreedingSchema.safeParse({
    sireId: formData.get("sireId"),
    damId: formData.get("damId"),
    startDate: formData.get("startDate"),
    targetGenotype: formData.get("targetGenotype"),
    targetSex: formData.get("targetSex") || undefined,
    notes: formData.get("notes") || undefined,
    allowOverride: formData.get("allowOverride") === "on",
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a sire and dam, then set a valid start date and target genotype.",
    };
  }

  const { idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeCreateBreedingSetupCommand({
    actor: user,
    command,
    idempotencyKey,
    requestId,
  });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/cages");
  revalidatePath("/breeding");

  return {
    status: "success",
    message: String(result.result && typeof result.result === "object" && "message" in result.result
      ? result.result.message
      : "Breeding setup created."),
  };
}

export async function recordLitterAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "breeding:manage" });
  const parsed = createLitterSchema.safeParse({
    breedingSetupId: formData.get("breedingSetupId"),
    birthDate: formData.get("birthDate"),
    litterSizeBirth: formData.get("litterSizeBirth"),
    notes: formData.get("notes") || undefined,
    expectedVersion: formData.get("expectedVersion"),
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a valid birth date and litter size before saving the litter record.",
    };
  }

  const { expectedVersion, idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeRecordBreedingLitterCommand({ actor: user, command, expectedVersion, idempotencyKey, requestId });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/breeding");

  return {
    status: "success",
    message: (result.result as { message?: string }).message ?? "Litter recorded.",
  };
}

export async function transitionBreedingAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "breeding:manage" });
  const parsed = transitionBreedingSchema.safeParse({
    breedingSetupId: formData.get("breedingSetupId"),
    targetStatus: formData.get("targetStatus"),
    happenedAt: formData.get("happenedAt"),
    reason: formData.get("reason"),
    expectedVersion: formData.get("expectedVersion"),
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Choose a valid breeding status, date, and reason." };
  }

  const { expectedVersion, idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeTransitionBreedingSetupCommand({
    actor: user,
    command,
    expectedVersion,
    idempotencyKey,
    requestId,
  });
  if (!result.ok) return { status: "error", message: result.message };

  ["/", "/animals", "/cages", "/breeding", "/workbook"].forEach((path) => revalidatePath(path));
  return {
    status: "success",
    message: (result.result as { message?: string }).message ?? "Breeding setup updated.",
  };
}

export async function weanLitterAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "breeding:manage" });
  const parsed = weanLitterSchema.safeParse({
    litterId: formData.get("litterId"),
    weanDate: formData.get("weanDate"),
    femaleCount: formData.get("femaleCount"),
    maleCount: formData.get("maleCount"),
    femaleCageId: formData.get("femaleCageId") || undefined,
    maleCageId: formData.get("maleCageId") || undefined,
    strainId: formData.get("strainId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a strain, valid cage assignments, and male or female counts before saving weaning.",
    };
  }

  const result = await weanLitterToCages(parsed.data, { id: user.id, role: user.role, activeLabId: user.activeLabId });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/cages");
  revalidatePath("/breeding");

  return {
    status: "success",
    message: result.message,
  };
}
