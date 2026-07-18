import { z } from "zod";

import {
  buildApiErrorResponse,
  buildItemResponse,
  buildMutationResponse,
  buildNotFoundResponse,
  requireApiUser,
} from "@/lib/api-route";
import {
  executeDeletePlannedExperimentAssignmentCommand,
  executeUpdatePlannedExperimentAssignmentCommand,
} from "@/lib/experiment-assignment-write";
import { getExperimentAssignmentApiRecordById } from "@/lib/integration-api";

const updatePlannedAssignmentSchema = z.object({
  expectedExperimentVersion: z.number().int().positive(),
  expectedAssignmentVersion: z.number().int().positive(),
  startDate: z.string().trim().min(1),
  treatmentGroup: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(400).nullable().optional(),
});

const deletePlannedAssignmentSchema = z.object({
  expectedExperimentVersion: z.number().int().positive(),
  expectedAssignmentVersion: z.number().int().positive(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const auth = await requireApiUser("experiments:full");
  if ("response" in auth) return auth.response;

  const { assignmentId } = await params;
  const assignment = await getExperimentAssignmentApiRecordById(assignmentId, auth.user);
  return assignment ? buildItemResponse(assignment) : buildNotFoundResponse("Experiment assignment", assignmentId);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const auth = await requireApiUser("experiments:manage");
  if ("response" in auth) return auth.response;

  const identity = commandIdentity(request);
  if (!identity) return buildApiErrorResponse("Idempotency-Key and X-Request-Id headers are required.", 400);
  const parsed = updatePlannedAssignmentSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    return buildApiErrorResponse("Invalid planned assignment update payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const { assignmentId } = await params;
  const existing = await getExperimentAssignmentApiRecordById(assignmentId, auth.user);
  if (!existing) return buildNotFoundResponse("Experiment assignment", assignmentId);

  const result = await executeUpdatePlannedExperimentAssignmentCommand({
    actor: auth.user,
    command: {
      experimentId: existing.experimentId,
      assignmentId,
      startDate: parsed.data.startDate,
      treatmentGroup: parsed.data.treatmentGroup,
      notes: parsed.data.notes,
    },
    expectedExperimentVersion: parsed.data.expectedExperimentVersion,
    expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
    ...identity,
  });
  if (!result.ok) return commandError(result);

  const assignment = await getExperimentAssignmentApiRecordById(assignmentId, auth.user);
  if (!assignment) return buildApiErrorResponse("Assignment was updated but could not be read back.", 500);
  return buildMutationResponse(assignment, {
    status: 200,
    created: false,
    message: resultMessage(result, "Planned assignment updated."),
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const auth = await requireApiUser("experiments:manage");
  if ("response" in auth) return auth.response;

  const identity = commandIdentity(request);
  if (!identity) return buildApiErrorResponse("Idempotency-Key and X-Request-Id headers are required.", 400);
  const parsed = deletePlannedAssignmentSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    return buildApiErrorResponse("Invalid planned assignment delete payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const { assignmentId } = await params;
  const existing = await getExperimentAssignmentApiRecordById(assignmentId, auth.user);
  if (!existing) return buildNotFoundResponse("Experiment assignment", assignmentId);

  const result = await executeDeletePlannedExperimentAssignmentCommand({
    actor: auth.user,
    command: { experimentId: existing.experimentId, assignmentId },
    expectedExperimentVersion: parsed.data.expectedExperimentVersion,
    expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
    ...identity,
  });
  if (!result.ok) return commandError(result);

  return buildMutationResponse(existing, {
    status: 200,
    created: false,
    message: resultMessage(result, "Planned assignment removed."),
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
      : ["stale_conflict", "idempotency_conflict", "command_in_progress"].includes(result.code ?? "") ? 409
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
