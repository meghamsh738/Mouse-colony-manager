"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { createAnimalRecord, importGenotypeCsvBatch } from "@/lib/colony-write";
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
  const user = await requireUser({ capability: "animals:manage" });
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

  const result = await createAnimalRecord(parsed.data, { id: user.id, role: user.role, activeLabId: user.activeLabId });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/animals");
  after(() => {
    revalidatePath("/");
    revalidatePath("/cages");
  });

  return {
    status: "success",
    message: result.message,
  };
}

export async function importGenotypeCsvAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "animals:manage" });
  const csvTextInput = String(formData.get("csvText") ?? "").trim();
  const fileField = formData.get("file");
  const file = fileField instanceof File && fileField.size > 0 ? fileField : null;

  if (!file && !csvTextInput) {
    return {
      status: "error",
      message: "Upload a CSV file or paste genotype rows before importing.",
    };
  }

  if (file && file.size > 1_000_000) {
    return {
      status: "error",
      message: "Keep genotype import files under 1 MB for the current MVP flow.",
    };
  }

  const csvText = file ? await file.text() : csvTextInput;
  const result = await importGenotypeCsvBatch(
    {
      csvText,
      fileName: file?.name,
    },
    { id: user.id, role: user.role, activeLabId: user.activeLabId },
  );

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/animals");
  after(() => ["/", "/breeding", "/cages", "/experiments"].forEach((path) => revalidatePath(path)));

  return {
    status: "success",
    message: result.message,
  };
}
