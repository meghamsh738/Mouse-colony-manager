"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { reserveAnimalForExperiment } from "@/lib/colony-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const reserveAnimalSchema = z.object({
  animalId: z.string().trim().min(1),
  experimentId: z.string().trim().min(1),
  startDate: z.string().trim().min(1),
  treatmentGroup: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(400).optional(),
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
