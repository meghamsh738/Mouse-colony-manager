"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createCryostorageRecord } from "@/lib/colony-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const recordCryostorageSchema = z.object({
  strainId: z.string().trim().min(1),
  projectId: z.string().trim().optional(),
  sampleLabel: z.string().trim().min(3).max(80),
  materialType: z.string().trim().min(2).max(80),
  status: z.enum(["stored", "reserved", "recovered", "depleted", "discarded"]),
  storedAt: z.string().trim().min(1),
  storageLocation: z.string().trim().max(120).optional(),
  quantityLabel: z.string().trim().max(80).optional(),
  recoveryNotes: z.string().trim().max(400).optional(),
  notes: z.string().trim().max(400).optional(),
});

export async function recordCryostorageAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = recordCryostorageSchema.safeParse({
    strainId: formData.get("strainId"),
    projectId: formData.get("projectId") || undefined,
    sampleLabel: formData.get("sampleLabel"),
    materialType: formData.get("materialType"),
    status: formData.get("status"),
    storedAt: formData.get("storedAt"),
    storageLocation: formData.get("storageLocation") || undefined,
    quantityLabel: formData.get("quantityLabel") || undefined,
    recoveryNotes: formData.get("recoveryNotes") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a strain, add the cryostorage label and material type, then enter the storage date before saving.",
    };
  }

  const result = await createCryostorageRecord(parsed.data, { id: user.id, role: user.role });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/cryostorage");
  revalidatePath("/settings");

  return {
    status: "success",
    message: result.message,
  };
}
