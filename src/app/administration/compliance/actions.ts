"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import {
  executeCreateProtocolDraftCommand,
  executeTransitionCompetencyEvidenceCommand,
  executeTransitionProtocolAuthorizationCommand,
  executeUpsertCompetencyEvidenceCommand,
} from "@/lib/protocol-governance";
import { requireUser } from "@/lib/session";

const commandIdentitySchema = z.object({
  idempotencyKey: z.string().uuid(),
  requestId: z.string().uuid(),
});

const protocolPersonnelRoleSchema = z.enum([
  "principal_investigator",
  "named_researcher",
  "procedure_operator",
  "breeding_operator",
  "intake_operator",
  "transfer_coordinator",
]);

const createProtocolSchema = commandIdentitySchema.extend({
  protocolCode: z.string().trim().min(2).max(60),
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().min(3).max(2_000),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date(),
  approvedAnimalCount: z.coerce.number().int().min(0).max(1_000_000),
  projectId: z.string().trim().min(1),
  experimentId: z.string().trim().optional(),
  strainId: z.string().trim().min(1),
  procedureCodes: z.string().trim().min(1).max(1_000),
  personnelUserId: z.string().trim().min(1),
  personnelRole: protocolPersonnelRoleSchema,
});

const protocolDecisionSchema = commandIdentitySchema.extend({
  authorizationId: z.string().trim().min(1),
  labId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  status: z.enum(["active", "suspended", "expired", "revoked"]),
  reason: z.string().trim().min(3).max(500),
});

const competencySchema = commandIdentitySchema.extend({
  membershipKey: z.string().trim().min(3),
  procedureCode: z.string().trim().min(2).max(100),
  evidenceType: z.string().trim().min(2).max(120),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date(),
  note: z.string().trim().max(500).optional(),
  expectedVersion: z.coerce.number().int().positive().optional(),
  renewRevoked: z.literal("on").optional(),
});

const competencyDecisionSchema = commandIdentitySchema.extend({
  evidenceId: z.string().trim().min(1),
  labId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  status: z.enum(["expired", "revoked"]),
  reason: z.string().trim().min(3).max(500),
});

function error(message: string): FormActionState {
  return { status: "error", message };
}

function revalidateCompliance() {
  revalidatePath("/administration/compliance");
  revalidatePath("/experiments");
  revalidatePath("/procedures");
}

function parseMembershipKey(value: string) {
  const separator = value.indexOf("|");
  if (separator < 1 || separator === value.length - 1) return null;
  return { labId: value.slice(0, separator), userId: value.slice(separator + 1) };
}

export async function createProtocolDraftAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "protocols:draft" });
  const parsed = createProtocolSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || !actor.activeLabId || parsed.data.validUntil <= parsed.data.validFrom) {
    return error("Enter the protocol identity, valid period, count, scope, procedure, and named person.");
  }
  const procedureCodes = [...new Set(parsed.data.procedureCodes.split(",").map((value) => value.trim()).filter(Boolean))];
  if (!procedureCodes.length) return error("Enter at least one procedure code.");
  const result = await executeCreateProtocolDraftCommand({
    actor,
    command: {
      labId: actor.activeLabId,
      protocolCode: parsed.data.protocolCode,
      title: parsed.data.title,
      summary: parsed.data.summary,
      validFrom: parsed.data.validFrom,
      validUntil: parsed.data.validUntil,
      approvedAnimalCount: parsed.data.approvedAnimalCount,
      projectIds: [parsed.data.projectId],
      experimentIds: parsed.data.experimentId ? [parsed.data.experimentId] : [],
      strainIds: [parsed.data.strainId],
      procedureCodes,
      personnel: [{ userId: parsed.data.personnelUserId, roleLabel: parsed.data.personnelRole }],
    },
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });
  if (!result.ok) return error(result.message ?? "The protocol draft could not be prepared.");
  revalidateCompliance();
  return { status: "success", message: "Private protocol draft prepared for independent review." };
}

export async function transitionProtocolAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "protocols:approve" });
  const parsed = protocolDecisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return error("Refresh the protocol and provide a valid status decision and reason.");
  const result = await executeTransitionProtocolAuthorizationCommand({
    actor,
    command: {
      authorizationId: parsed.data.authorizationId,
      labId: parsed.data.labId,
      status: parsed.data.status,
      reason: parsed.data.reason,
    },
    expectedVersion: parsed.data.expectedVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });
  if (!result.ok) return error(result.message ?? "The protocol decision could not be recorded.");
  revalidateCompliance();
  return { status: "success", message: `Protocol status changed to ${parsed.data.status.replaceAll("_", " ")}.` };
}

export async function upsertCompetencyAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "competencies:manage" });
  const parsed = competencySchema.safeParse(Object.fromEntries(formData));
  const membership = parsed.success ? parseMembershipKey(parsed.data.membershipKey) : null;
  if (!parsed.success || !membership || parsed.data.validUntil <= parsed.data.validFrom) {
    return error("Choose an active lab member and enter valid competency evidence and dates.");
  }
  const result = await executeUpsertCompetencyEvidenceCommand({
    actor,
    command: {
      ...membership,
      procedureCode: parsed.data.procedureCode,
      evidenceType: parsed.data.evidenceType,
      validFrom: parsed.data.validFrom,
      validUntil: parsed.data.validUntil,
      note: parsed.data.note,
      renewRevoked: parsed.data.renewRevoked === "on",
    },
    expectedVersion: parsed.data.expectedVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });
  if (!result.ok) return error(result.message ?? "The competency evidence could not be recorded.");
  revalidateCompliance();
  return { status: "success", message: parsed.data.expectedVersion ? "Competency evidence renewed." : "Competency evidence issued." };
}

export async function transitionCompetencyAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "competencies:manage" });
  const parsed = competencyDecisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return error("Refresh the record and provide a valid status decision and reason.");
  const result = await executeTransitionCompetencyEvidenceCommand({
    actor,
    command: {
      evidenceId: parsed.data.evidenceId,
      labId: parsed.data.labId,
      status: parsed.data.status,
      reason: parsed.data.reason,
    },
    expectedVersion: parsed.data.expectedVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });
  if (!result.ok) return error(result.message ?? "The competency status could not be changed.");
  revalidateCompliance();
  return { status: "success", message: `Competency evidence marked ${parsed.data.status}.` };
}
