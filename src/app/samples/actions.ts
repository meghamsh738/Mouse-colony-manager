"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { createSampleRecord } from "@/lib/colony-write";
import { requireUser } from "@/lib/session";

const recordSampleSchema = z.object({
  animalId: z.string().trim().min(1),
  projectId: z.string().trim().optional(),
  sampleLabel: z.string().trim().min(3).max(80),
  sampleType: z.string().trim().min(2).max(80),
  status: z.enum(["collected", "stored", "allocated", "consumed", "discarded"]),
  collectedAt: z.string().trim().min(1),
  storageLocation: z.string().trim().max(120).optional(),
  quantityLabel: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(400).optional(),
});

export async function recordSampleAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = recordSampleSchema.safeParse({
    animalId: formData.get("animalId"),
    projectId: formData.get("projectId") || undefined,
    sampleLabel: formData.get("sampleLabel"),
    sampleType: formData.get("sampleType"),
    status: formData.get("status"),
    collectedAt: formData.get("collectedAt"),
    storageLocation: formData.get("storageLocation") || undefined,
    quantityLabel: formData.get("quantityLabel") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose an animal, enter the sample label and type, then add the collection date before saving.",
    };
  }

  const result = await createSampleRecord(parsed.data, { id: user.id, role: user.role });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/samples");
  revalidatePath("/animals");
  revalidatePath(`/animals/${parsed.data.animalId}`);

  return {
    status: "success",
    message: result.message,
  };
}
