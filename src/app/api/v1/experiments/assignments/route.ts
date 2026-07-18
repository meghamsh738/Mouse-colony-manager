import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import {
  executeDemoteExperimentAssignmentsCommand,
  executePlanExperimentAssignmentsCommand,
  executePromoteExperimentAssignmentsCommand,
} from "@/lib/experiment-assignment-write";
import {
  getExperimentAssignmentApiRecords,
  getExperimentAssignmentApiRecordsForExperiment,
  resolveExperimentApiReference,
  resolveExperimentAssignmentApiInput,
} from "@/lib/integration-api";

const assignmentSyncSchema = z.object({
  experimentId: z.string().trim().min(1).optional(),
  experimentCode: z.string().trim().min(1).optional(),
  expectedExperimentVersion: z.number().int().positive(),
  startDate: z.string().trim().min(1),
  notes: z.string().trim().max(400).optional(),
  assignments: z.array(
    z.object({
      animalId: z.string().trim().min(1).optional(),
      animalCode: z.string().trim().min(1).optional(),
      treatmentGroup: z.string().trim().min(1).max(80),
    }),
  ).min(1).max(100),
});

const assignmentStatusSyncSchema = z.object({
  experimentId: z.string().trim().min(1).optional(),
  experimentCode: z.string().trim().min(1).optional(),
  expectedExperimentVersion: z.number().int().positive(),
  action: z.enum(["promote_planned", "rollback_reserved"]),
  assignments: z.array(z.object({
    assignmentId: z.string().trim().min(1),
    expectedVersion: z.number().int().positive(),
  })).min(1).max(100),
});

export async function POST(request: Request) {
  const auth = await requireApiUser("experiments:manage");
  if ("response" in auth) return auth.response;

  const identity = commandIdentity(request);
  if (!identity) return buildApiErrorResponse("Idempotency-Key and X-Request-Id headers are required.", 400);
  const parsed = assignmentSyncSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    return buildApiErrorResponse("Invalid experiment assignment payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveExperimentAssignmentApiInput(parsed.data, auth.user);
  if (!resolved.ok) return buildApiErrorResponse(resolved.message, resolved.status);

  const result = await executePlanExperimentAssignmentsCommand({
    actor: auth.user,
    command: {
      experimentId: resolved.value.experimentId,
      startDate: parsed.data.startDate,
      notes: parsed.data.notes,
      assignments: resolved.value.assignments.map((assignment) => ({
        animalId: assignment.animalCode,
        treatmentGroup: assignment.treatmentGroup,
      })),
    },
    expectedExperimentVersion: parsed.data.expectedExperimentVersion,
    ...identity,
  });
  if (!result.ok) return commandError(result);

  const records = await getExperimentAssignmentApiRecords({
    experimentId: resolved.value.experimentId,
    animalIds: resolved.value.assignments.map((assignment) => assignment.animalId),
  }, auth.user);
  if (records.length !== resolved.value.assignments.length) {
    return buildApiErrorResponse("Assignments were written but the exact snapshot could not be read back.", 500);
  }
  return buildMutationResponse(records, {
    status: result.replayed ? 200 : 201,
    created: !result.replayed,
    message: resultMessage(result, "Experiment assignments planned."),
  });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser("experiments:manage");
  if ("response" in auth) return auth.response;

  const identity = commandIdentity(request);
  if (!identity) return buildApiErrorResponse("Idempotency-Key and X-Request-Id headers are required.", 400);
  const parsed = assignmentStatusSyncSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    return buildApiErrorResponse("Invalid experiment assignment status payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveExperimentApiReference(parsed.data, auth.user);
  if (!resolved.ok) return buildApiErrorResponse(resolved.message, resolved.status);
  const commandInput = {
    actor: auth.user,
    command: { experimentId: resolved.value.experimentId, assignments: parsed.data.assignments },
    expectedExperimentVersion: parsed.data.expectedExperimentVersion,
    ...identity,
  };
  const result = parsed.data.action === "promote_planned"
    ? await executePromoteExperimentAssignmentsCommand(commandInput)
    : await executeDemoteExperimentAssignmentsCommand(commandInput);
  if (!result.ok) return commandError(result);

  const assignmentIds = new Set(parsed.data.assignments.map((assignment) => assignment.assignmentId));
  const records = (await getExperimentAssignmentApiRecordsForExperiment({
    experimentId: resolved.value.experimentId,
    statuses: parsed.data.action === "promote_planned" ? ["reserved"] : ["planned"],
  }, auth.user)).filter((assignment) => assignmentIds.has(assignment.id));
  if (records.length !== parsed.data.assignments.length) {
    return buildApiErrorResponse("The assignment command succeeded but the exact snapshot could not be read back.", 500);
  }
  return buildMutationResponse(records, {
    status: 200,
    created: false,
    message: resultMessage(result, "Experiment assignments updated."),
  });
}

function commandIdentity(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  const requestId = request.headers.get("x-request-id")?.trim();
  return idempotencyKey && requestId ? { idempotencyKey, requestId } : null;
}

function resultMessage(result: { result?: unknown; message?: string }, fallback: string) {
  if (result.result && typeof result.result === "object" && !Array.isArray(result.result)) {
    const message = (result.result as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return result.message ?? fallback;
}

function commandError(result: { code?: string; message?: string }) {
  const status = result.code === "forbidden" ? 403
    : result.code === "not_found" ? 404
      : ["stale_conflict", "idempotency_conflict", "command_in_progress", "duplicate_assignment"].includes(result.code ?? "") ? 409
        : result.code === "unexpected_error" ? 500
          : 400;
  return buildApiErrorResponse(result.message ?? "The assignment command failed.", status);
}

async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
