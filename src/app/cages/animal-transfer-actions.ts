"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { executeMoveAnimalToCageCommand } from "@/lib/colony-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const animalTransferSchema = z.object({
  animalId: z.string().trim().min(1),
  toCageId: z.string().trim().min(1),
  movedAt: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.coerce.number().int().min(1),
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
});

export async function moveAnimalTransferAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "cages:manage" });
  const parsed = animalTransferSchema.safeParse({
    animalId: formData.get("animalId"),
    toCageId: formData.get("toCageId"),
    movedAt: formData.get("movedAt"),
    reason: formData.get("reason"),
    expectedVersion: formData.get("expectedVersion"),
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose an animal, destination cage, transfer date, and reason.",
    };
  }

  const { expectedVersion, idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeMoveAnimalToCageCommand({
    actor: user,
    command,
    expectedVersion,
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
  const moved = result.result as {
    message: string;
    animalId: string;
    fromCageId: string;
    toCageId: string;
    fromCageBarcode: string;
    toCageBarcode: string;
  };
  revalidatePath(`/animals/${moved.animalId}`);
  revalidatePath(`/cages/${moved.fromCageId}`);
  revalidatePath(`/cages/${moved.toCageId}`);
  revalidatePath(`/scan/${moved.fromCageBarcode}`);
  revalidatePath(`/scan/${moved.toCageBarcode}`);

  return {
    status: "success",
    message: moved.message,
  };
}
