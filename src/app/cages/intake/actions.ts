"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  executeCageIntakeCommand,
  type CageIntakeCommand,
} from "@/lib/cage-intake-write";
import {
  initialCageIntakeDraftActionState,
  type CageIntakeDraftActionState,
} from "@/lib/cage-intake-action-state";
import { cageIntakeDraftPayloadSchema } from "@/lib/cage-intake-draft";
import { prepareWorkflowReview, upsertWorkflowDraft } from "@/lib/command-foundation";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const dateOnlySchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});

const destinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), cageId: z.string().trim().min(1) }),
  z.object({ kind: z.literal("new"), clientId: z.string().trim().min(1) }),
]);

const cageDraftSchema = z.object({
  clientId: z.string().trim().min(1),
  labId: z.string().trim().min(1),
  roomId: z.string().trim().min(1),
  rackId: z.string().trim().min(1),
  cageNumber: z.string().trim().min(1).max(20),
  barcode: z.string().trim().max(80).optional(),
  capacityOverride: z.number().int().min(1).max(6).nullable().optional(),
  status: z.enum(["active", "breeding", "quarantine", "experiment"]),
  chargeCategoryId: z.string().trim().min(1).optional(),
  startDate: dateOnlySchema,
  notes: z.string().trim().max(500).optional(),
});

const newCagePayloadSchema = z.object({
  cages: z.array(cageDraftSchema).min(1).max(50),
  assignments: z
    .array(z.object({ subjectId: z.string().trim().min(1), destination: destinationSchema }))
    .max(300),
  movedAt: dateOnlySchema,
  reason: z.string().trim().min(3).max(300),
});

const weaningPayloadSchema = z.object({
  protocolAuthorizationId: z.string().trim().min(1),
  litterId: z.string().trim().min(1),
  weanDate: dateOnlySchema,
  strainId: z.string().trim().min(1),
  pups: z
    .array(
      z.object({
        rowId: z.string().trim().min(1),
        sex: z.enum(["male", "female"]),
        destination: destinationSchema,
      }),
    )
    .min(1)
    .max(100),
  cages: z.array(cageDraftSchema).max(50),
});

const purchasePayloadSchema = z.object({
  protocolAuthorizationId: z.string().trim().min(1),
  labId: z.string().trim().min(1),
  vendor: z.string().trim().min(2).max(200),
  orderReference: z.string().trim().min(2).max(200),
  arrivalDate: dateOnlySchema,
  disposition: z.enum(["holding", "quarantine"]),
  notes: z.string().trim().max(500).optional(),
  animals: z
    .array(
      z.object({
        rowId: z.string().trim().min(1),
        sourceAnimalId: z.string().trim().max(100).optional(),
        sex: z.enum(["male", "female", "unknown"]),
        strainId: z.string().trim().min(1),
        dob: dateOnlySchema,
        healthNotes: z.string().trim().max(500).optional(),
        destination: destinationSchema,
      }),
    )
    .min(1)
    .max(300),
  cages: z.array(cageDraftSchema).max(50),
});

export async function saveCageIntakeDraftAction(
  previousState: CageIntakeDraftActionState = initialCageIntakeDraftActionState,
  formData: FormData,
): Promise<CageIntakeDraftActionState> {
  const user = await requireUser({ capability: "cages:manage" });
  const draftId = String(formData.get("workflowDraftId") ?? "").trim();
  const expectedVersion = Number(formData.get("expectedVersion") ?? previousState.draftVersion ?? 0);
  const parsedDraft = parseDraftPayload(formData);
  if (!parsedDraft.ok) return { ...previousState, status: "error", message: parsedDraft.message };
  if (draftId.length < 16 || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return { ...previousState, status: "error", message: "The draft session is invalid. Refresh and try again." };
  }

  const saved = await upsertWorkflowDraft({
    actor: user,
    draftId,
    workflowType: `cage_intake.${parsedDraft.value.mode}`,
    requiredCapability: "cages:manage",
    labId: parsedDraft.value.labId || user.activeLabId,
    expectedVersion,
    payload: parsedDraft.value as unknown as Prisma.InputJsonValue,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
  });
  if (!saved.ok) return { ...previousState, status: "error", message: saved.message };

  return {
    status: "success",
    message: "Draft saved.",
    draftId: saved.draft.id,
    draftVersion: saved.draft.version,
    resumeUrl: `/cages/intake?draftId=${encodeURIComponent(saved.draft.id)}`,
  };
}

export async function submitCageIntakeAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "cages:manage" });
  const workflowDraftId = String(formData.get("workflowDraftId") ?? "").trim();

  if (workflowDraftId.length < 16) {
    return { status: "error", message: "The intake session expired. Refresh the page and try again." };
  }

  const parsedDraft = parseDraftPayload(formData);
  if (!parsedDraft.ok) return { status: "error", message: parsedDraft.message };
  const mode = parsedDraft.value.mode;
  const commandPayload = storedCommandPayload(parsedDraft.value.command, mode);
  const command =
    mode === "new"
      ? parseCommand(newCagePayloadSchema, commandPayload, (value) => ({ mode: "new", payload: value }))
      : mode === "wean"
        ? parseCommand(weaningPayloadSchema, commandPayload, (value) => ({ mode: "wean", payload: value }))
        : mode === "purchase"
          ? parseCommand(purchasePayloadSchema, commandPayload, (value) => ({ mode: "purchase", payload: value }))
          : { ok: false as const, message: "Choose a valid cage intake mode." };

  if (!command.ok) {
    return { status: "error", message: command.message };
  }

  const review = await prepareWorkflowReview({
    actor: user,
    draftId: workflowDraftId,
    workflowType: `cage_intake.${mode}`,
    requiredCapability: "cages:manage",
    labId: commandLabId(command.value, user.activeLabId),
    payload: parsedDraft.value as unknown as Prisma.InputJsonValue,
  });
  if (!review.ok) {
    return { status: "error", message: review.message };
  }

  const reviewedDraft = cageIntakeDraftPayloadSchema.safeParse(review.snapshot.payload);
  if (!reviewedDraft.success) {
    return { status: "error", message: "The reviewed intake snapshot could not be read." };
  }
  const reviewedCommandPayload = storedCommandPayload(reviewedDraft.data.command, mode);
  const reviewedCommand =
    mode === "new"
      ? parseCommand(newCagePayloadSchema, reviewedCommandPayload, (value) => ({ mode: "new", payload: value }))
      : mode === "wean"
        ? parseCommand(weaningPayloadSchema, reviewedCommandPayload, (value) => ({ mode: "wean", payload: value }))
        : parseCommand(purchasePayloadSchema, reviewedCommandPayload, (value) => ({ mode: "purchase", payload: value }));
  if (!reviewedCommand.ok) return { status: "error", message: reviewedCommand.message };
  if (mode === "wean" && !reviewedDraft.data.litterVersion) {
    return { status: "error", message: "The litter version is missing. Refresh and review the current litter before confirming." };
  }

  const result = await executeCageIntakeCommand({
    actor: user,
    command: reviewedCommand.value,
    idempotencyKey: review.snapshot.id,
    requestId: review.snapshot.id,
    workflowDraftId: review.draft.id,
    reviewSnapshotId: review.snapshot.id,
    expectedVersion: reviewedDraft.data.litterVersion,
  });

  if (!result.ok) {
    return { status: "error", message: result.message ?? "The intake could not be completed." };
  }

  ["/", "/animals", "/breeding", "/cages", "/cages/intake", "/billing", "/notifications"].forEach(
    (path) => revalidatePath(path),
  );

  const commandResult = result.result as { message?: string } | null;
  return { status: "success", message: commandResult?.message ?? "Cage intake completed." };
}

function parseDraftPayload(formData: FormData) {
  const text = String(formData.get("draftPayload") ?? "");
  if (!text || text.length > 1_000_000) {
    return { ok: false as const, message: "The intake draft is empty or too large." };
  }
  try {
    const parsed = cageIntakeDraftPayloadSchema.safeParse(JSON.parse(text));
    return parsed.success
      ? { ok: true as const, value: parsed.data }
      : { ok: false as const, message: "Review the intake fields before saving." };
  } catch {
    return { ok: false as const, message: "The intake draft could not be read. Refresh and try again." };
  }
}

function commandLabId(command: CageIntakeCommand, activeLabId: string | null) {
  if (command.mode === "purchase") return command.payload.labId;
  const labIds = [...new Set(command.payload.cages.map((cage) => cage.labId).filter(Boolean))];
  return labIds.length === 1 ? labIds[0] : activeLabId;
}

function storedCommandPayload(command: unknown, mode: CageIntakeCommand["mode"]) {
  if (
    command
    && typeof command === "object"
    && "mode" in command
    && "payload" in command
    && command.mode === mode
  ) {
    return command.payload;
  }

  return command;
}

function parseCommand<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  toCommand: (value: T) => CageIntakeCommand,
) {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    return { ok: false as const, message: "Review the required fields and cage assignments before confirming." };
  }

  return { ok: true as const, value: toCommand(parsed.data) };
}
