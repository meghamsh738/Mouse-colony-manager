"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import {
  executeUpdateAnimalLifecycleCommand,
  executeUpdateAnimalPresenceCommand,
  recordAnimalGenotype,
} from "@/lib/colony-write";
import { prepareWorkflowReview } from "@/lib/command-foundation";
import { parseExactLifecycleTimestamp } from "@/lib/lifecycle-provenance";
import { executeReserveAnimalForExperimentCommand } from "@/lib/experiment-assignment-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const reserveAnimalSchema = z.object({
  animalId: z.string().trim().min(1),
  experimentId: z.string().trim().min(1),
  startDate: z.string().trim().min(1),
  treatmentGroup: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(400).optional(),
  expectedAnimalVersion: z.coerce.number().int().min(1),
  expectedExperimentVersion: z.coerce.number().int().min(1),
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
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
  attachmentLabel: z.string().trim().max(120).optional(),
});

const updateLifecycleSchema = z.object({
  animalId: z.string().trim().min(1),
  targetStatus: z.enum(["euthanized", "dead", "transferred_out", "archived"]),
  happenedAt: z.string().trim().min(1).max(40),
  reason: z.string().trim().min(3).max(400),
  destination: z.string().trim().max(160).optional(),
  transferReference: z.string().trim().max(120).optional(),
  sopAssignmentId: z.string().trim().min(1).optional(),
  expectedVersion: z.coerce.number().int().min(1),
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
  workflowDraftId: z.string().trim().min(16),
}).superRefine((value, context) => {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.happenedAt);
  const exactDateTime = Boolean(parseExactLifecycleTimestamp(value.happenedAt));
  if (value.targetStatus === "euthanized" && !exactDateTime) {
    context.addIssue({ code: "custom", path: ["happenedAt"], message: "Choose the exact euthanasia date and time." });
  }
  if (value.targetStatus !== "euthanized" && !dateOnly) {
    context.addIssue({ code: "custom", path: ["happenedAt"], message: "Choose a lifecycle date." });
  }
  if (value.targetStatus === "transferred_out" && !value.destination) {
    context.addIssue({ code: "custom", path: ["destination"], message: "A receiving facility is required." });
  }
  if (value.targetStatus !== "transferred_out" && (value.destination || value.transferReference)) {
    context.addIssue({ code: "custom", path: ["destination"], message: "Transfer fields only apply to a transferred-out disposition." });
  }
  if (value.targetStatus === "euthanized" && !value.sopAssignmentId) {
    context.addIssue({ code: "custom", path: ["sopAssignmentId"], message: "Choose the approved euthanasia SOP." });
  }
  if (value.targetStatus !== "euthanized" && value.sopAssignmentId) {
    context.addIssue({ code: "custom", path: ["sopAssignmentId"], message: "SOP provenance only applies to euthanasia." });
  }
});

const updatePresenceSchema = z.object({
  animalId: z.string().trim().min(1),
  action: z.enum(["missing", "found"]),
  happenedAt: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(400),
  toCageId: z.string().trim().optional(),
  expectedVersion: z.coerce.number().int().min(1),
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
});

export async function updateAnimalPresenceAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "animals:manage" });
  const parsed = updatePresenceSchema.safeParse({
    animalId: formData.get("animalId"), action: formData.get("action"),
    happenedAt: formData.get("happenedAt"), reason: formData.get("reason"),
    toCageId: formData.get("toCageId") || undefined,
    expectedVersion: formData.get("expectedVersion"),
    idempotencyKey: formData.get("idempotencyKey"), requestId: formData.get("requestId"),
  });
  if (!parsed.success) return { status: "error", message: "Enter the date, reason, and destination cage when required." };
  const { expectedVersion, idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeUpdateAnimalPresenceCommand({ actor: user, command, expectedVersion, idempotencyKey, requestId });
  if (!result.ok) return { status: "error", message: result.message ?? "The location status could not be updated." };
  revalidatePath(`/animals/${command.animalId}`);
  after(() => ["/", "/animals", "/cages", "/notifications"].forEach((path) => revalidatePath(path)));
  const saved = result.result as { message?: string };
  return { status: "success", message: saved.message ?? "Animal location status updated." };
}

export async function reserveAnimalAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "experiments:manage" });
  const parsed = reserveAnimalSchema.safeParse({
    animalId: formData.get("animalId"),
    experimentId: formData.get("experimentId"),
    startDate: formData.get("startDate"),
    treatmentGroup: formData.get("treatmentGroup") || undefined,
    notes: formData.get("notes") || undefined,
    expectedAnimalVersion: formData.get("expectedAnimalVersion"),
    expectedExperimentVersion: formData.get("expectedExperimentVersion"),
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose an experiment and planned start date before reserving the animal.",
    };
  }

  const {
    expectedAnimalVersion,
    expectedExperimentVersion,
    idempotencyKey,
    requestId,
    ...command
  } = parsed.data;
  const result = await executeReserveAnimalForExperimentCommand({
    actor: user,
    command,
    expectedAnimalVersion,
    expectedExperimentVersion,
    idempotencyKey,
    requestId,
  });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message ?? "The reservation could not be saved.",
    };
  }

  revalidatePath(`/animals/${command.animalId}`);
  after(() => ["/", "/animals", "/experiments"].forEach((path) => revalidatePath(path)));

  const saved = result.result as { message?: string };
  return {
    status: "success",
    message: saved.message ?? "Animal reserved for the experiment.",
  };
}

export async function recordGenotypeAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "animals:manage" });
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
    attachmentLabel: formData.get("attachmentLabel") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose an allele, enter the assay dates, and add a genotype result before saving.",
    };
  }

  const attachmentField = formData.get("attachment");
  const attachment = attachmentField instanceof File && attachmentField.size > 0 ? attachmentField : undefined;
  const { attachmentLabel, ...genotypeInput } = parsed.data;

  const result = await recordAnimalGenotype(
    {
      ...genotypeInput,
      attachment: attachment
        ? {
            file: attachment,
            label: attachmentLabel,
          }
        : undefined,
    },
    { id: user.id, role: user.role, activeLabId: user.activeLabId },
  );

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  after(() => ["/", "/animals", "/breeding", "/cages", "/experiments", `/animals/${parsed.data.animalId}`]
    .forEach((path) => revalidatePath(path)));

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
  const user = await requireUser({ capability: "animals:manage" });
  const parsed = updateLifecycleSchema.safeParse({
    animalId: formData.get("animalId"),
    targetStatus: formData.get("targetStatus"),
    happenedAt: formData.get("happenedAt"),
    reason: formData.get("reason"),
    destination: formData.get("destination") || undefined,
    transferReference: formData.get("transferReference") || undefined,
    sopAssignmentId: formData.get("sopAssignmentId") || undefined,
    expectedVersion: formData.get("expectedVersion"),
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    workflowDraftId: formData.get("workflowDraftId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a terminal lifecycle action, date, and reason before saving.",
    };
  }

  const { expectedVersion, idempotencyKey, requestId, workflowDraftId, ...command } = parsed.data;
  const review = await prepareWorkflowReview({
    actor: user,
    draftId: workflowDraftId,
    workflowType: "animal.lifecycle",
    requiredCapability: "animals:manage",
    labId: user.canonicalRole === "lab_user" ? user.activeLabId : null,
    payload: { command, expectedVersion } as unknown as Prisma.InputJsonValue,
    allowCommittedReplay: true,
  });
  if (!review.ok) return { status: "error", message: review.message };
  const result = await executeUpdateAnimalLifecycleCommand({
    actor: user,
    command,
    expectedVersion,
    idempotencyKey,
    requestId,
    workflowDraftId: review.draft.id,
    reviewSnapshotId: review.snapshot.id,
  });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message ?? "The lifecycle change could not be saved.",
    };
  }

  after(() => ["/", "/animals", "/breeding", "/cages", "/experiments", `/animals/${command.animalId}`]
    .forEach((path) => revalidatePath(path)));

  const saved = result.result as { message?: string };
  return {
    status: "success",
    message: saved.message ?? "Lifecycle change saved.",
  };
}
