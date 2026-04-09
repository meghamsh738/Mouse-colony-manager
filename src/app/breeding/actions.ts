"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createBreedingSetup, recordBreedingLitter } from "@/lib/colony-write";
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
});

const createLitterSchema = z.object({
  breedingSetupId: z.string().trim().min(1),
  birthDate: z.string().trim().min(1),
  litterSizeBirth: z.coerce.number().int().min(1).max(24),
  notes: z.string().trim().max(400).optional(),
});

export async function createBreedingAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = createBreedingSchema.safeParse({
    sireId: formData.get("sireId"),
    damId: formData.get("damId"),
    startDate: formData.get("startDate"),
    targetGenotype: formData.get("targetGenotype"),
    targetSex: formData.get("targetSex") || undefined,
    notes: formData.get("notes") || undefined,
    allowOverride: formData.get("allowOverride") === "on",
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a sire and dam, then set a valid start date and target genotype.",
    };
  }

  const result = await createBreedingSetup(parsed.data, { id: user.id, role: user.role });

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

export async function recordLitterAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = createLitterSchema.safeParse({
    breedingSetupId: formData.get("breedingSetupId"),
    birthDate: formData.get("birthDate"),
    litterSizeBirth: formData.get("litterSizeBirth"),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a valid birth date and litter size before saving the litter record.",
    };
  }

  const result = await recordBreedingLitter(parsed.data, { id: user.id, role: user.role });

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
    message: result.message,
  };
}
