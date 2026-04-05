"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAnimalRecord } from "@/lib/colony-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const createAnimalSchema = z.object({
  animalId: z.string().trim().min(3),
  labId: z.string().trim().min(3),
  sex: z.enum(["male", "female", "unknown"]),
  dob: z.string().trim().min(1),
  strainId: z.string().trim().min(1),
  cageId: z.string().trim().min(1),
  projectId: z.string().trim().optional(),
  notes: z.string().trim().max(400).optional(),
});

export async function createAnimalAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = createAnimalSchema.safeParse({
    animalId: formData.get("animalId"),
    labId: formData.get("labId"),
    sex: formData.get("sex"),
    dob: formData.get("dob"),
    strainId: formData.get("strainId"),
    cageId: formData.get("cageId"),
    projectId: formData.get("projectId") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Complete the animal form with valid identifiers, housing, and date of birth.",
    };
  }

  const result = await createAnimalRecord(parsed.data, { id: user.id, role: user.role });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/cages");

  return {
    status: "success",
    message: result.message,
  };
}
