"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { moveCageSchema } from "@/lib/cage-move-schema";
import { addCageHealthNote, moveCageLocation } from "@/lib/colony-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const healthNoteSchema = z.object({
  cageId: z.string().trim().min(1),
  noteType: z.enum([
    "routine_welfare",
    "adverse_effect",
    "veterinary_concern",
    "breeding_concern",
    "underweight",
    "overweight",
    "grooming_issue",
    "aggression",
    "pregnancy_suspicion",
    "delivery_observed",
    "post_procedure_monitoring",
  ]),
  severity: z.enum(["info", "warning", "critical"]),
  note: z.string().trim().min(6).max(500),
  followupRequired: z.string().optional(),
  actionTaken: z.string().trim().max(300).optional(),
});

export async function addCageHealthNoteAction(
  barcode: string,
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = healthNoteSchema.safeParse({
    cageId: formData.get("cageId"),
    noteType: formData.get("noteType"),
    severity: formData.get("severity"),
    note: formData.get("note"),
    followupRequired: formData.get("followupRequired") || undefined,
    actionTaken: formData.get("actionTaken") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a note type, severity, and a concise welfare note.",
    };
  }

  const result = await addCageHealthNote(
    {
      ...parsed.data,
      followupRequired: parsed.data.followupRequired === "on",
    },
    { id: user.id, role: user.role },
  );

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/cages");
  revalidatePath(`/scan/${barcode}`);

  return {
    status: "success",
    message: result.message,
  };
}

export async function moveCageFromScanAction(
  barcode: string,
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
  revalidatePath(`/scan/${barcode}`);

  return {
    status: "success",
    message: result.message,
  };
}
