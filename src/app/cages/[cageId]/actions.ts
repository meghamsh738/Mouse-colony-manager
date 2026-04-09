"use server";

import { revalidatePath } from "next/cache";

import { moveCageSchema } from "@/lib/cage-move-schema";
import { moveCageLocation } from "@/lib/colony-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

export async function moveCageAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
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

  const result = await moveCageLocation(parsed.data, { id: user.id, role: user.role });

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
