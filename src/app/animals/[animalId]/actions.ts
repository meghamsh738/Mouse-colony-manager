"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { recordAnimalGenotype, reserveAnimalForExperiment, updateAnimalLifecycleStatus } from "@/lib/colony-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const reserveAnimalSchema = z.object({
  animalId: z.string().trim().min(1),
  experimentId: z.string().trim().min(1),
  startDate: z.string().trim().min(1),
  treatmentGroup: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(400).optional(),
});

const recordGenotypeSchema = z.object({
  animalId: z.string().trim().min(1),
  alleleId: z.string().trim().min(1),
  zygosity: z.string().trim().min(1).max(40),
  status: z.enum(["pending", "provisional", "confirmed", "conflict"]),
  sourceType: z.string().trim().min(2).max(80),
  assayType: z.string().trim().min(2).max(80),
  sampleDate: z.string().trim().min(1),
  resultDate: z.string().trim().min(1),
  resultText: z.string().trim().min(3).max(400),
  confidence: z.string().trim().max(40).optional(),
  provider: z.string().trim().max(80).optional(),
  sampleId: z.string().trim().max(80).optional(),
});

const updateLifecycleSchema = z.object({
  animalId: z.string().trim().min(1),
  targetStatus: z.enum(["euthanized", "dead", "transferred_out", "archived"]),
  happenedAt: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(400),
});

export async function reserveAnimalAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = reserveAnimalSchema.safeParse({
    animalId: formData.get("animalId"),
    experimentId: formData.get("experimentId"),
    startDate: formData.get("startDate"),
    treatmentGroup: formData.get("treatmentGroup") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose an experiment and planned start date before reserving the animal.",
    };
  }

  const result = await reserveAnimalForExperiment(parsed.data, { id: user.id, role: user.role });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/experiments");
  revalidatePath(`/animals/${parsed.data.animalId}`);

  return {
    status: "success",
    message: result.message,
  };
}

export async function recordGenotypeAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = recordGenotypeSchema.safeParse({
    animalId: formData.get("animalId"),
    alleleId: formData.get("alleleId"),
    zygosity: formData.get("zygosity"),
    status: formData.get("status"),
    sourceType: formData.get("sourceType"),
    assayType: formData.get("assayType"),
    sampleDate: formData.get("sampleDate"),
    resultDate: formData.get("resultDate"),
    resultText: formData.get("resultText"),
    confidence: formData.get("confidence") || undefined,
    provider: formData.get("provider") || undefined,
    sampleId: formData.get("sampleId") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose an allele, enter the assay dates, and add a genotype result before saving.",
    };
  }

  const result = await recordAnimalGenotype(parsed.data, { id: user.id, role: user.role });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/breeding");
  revalidatePath("/cages");
  revalidatePath("/experiments");
  revalidatePath(`/animals/${parsed.data.animalId}`);

  return {
    status: "success",
    message: result.message,
  };
}

export async function updateAnimalLifecycleAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = updateLifecycleSchema.safeParse({
    animalId: formData.get("animalId"),
    targetStatus: formData.get("targetStatus"),
    happenedAt: formData.get("happenedAt"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a terminal lifecycle action, date, and reason before saving.",
    };
  }

  const result = await updateAnimalLifecycleStatus(parsed.data, { id: user.id, role: user.role });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/breeding");
  revalidatePath("/cages");
  revalidatePath("/experiments");
  revalidatePath(`/animals/${parsed.data.animalId}`);

  return {
    status: "success",
    message: result.message,
  };
}
