import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { executeReserveAnimalForExperimentCommand } from "@/lib/experiment-assignment-write";
import {
  getExperimentAssignmentApiRecordById,
  resolveExperimentReservationApiInput,
} from "@/lib/integration-api";

const experimentReservationSchema = z.object({
  experimentId: z.string().trim().min(1).optional(),
  experimentCode: z.string().trim().min(1).optional(),
  animalId: z.string().trim().min(1).optional(),
  animalCode: z.string().trim().min(1).optional(),
  expectedAnimalVersion: z.number().int().positive(),
  expectedExperimentVersion: z.number().int().positive(),
  startDate: z.string().trim().min(1),
  treatmentGroup: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(400).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser("experiments:manage");

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot sync experiment reservations.", 403);
  }

  const identity = commandIdentity(request);
  if (!identity) {
    return buildApiErrorResponse("Idempotency-Key and X-Request-Id headers are required.", 400);
  }
  const body = await parseJsonBody(request);
  const parsed = experimentReservationSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid experiment reservation payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveExperimentReservationApiInput(parsed.data, auth.user);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const result = await executeReserveAnimalForExperimentCommand({
    actor: auth.user,
    command: {
      animalId: resolved.value.animalId,
      experimentId: resolved.value.experimentId,
      startDate: parsed.data.startDate,
      treatmentGroup: resolved.value.treatmentGroup,
      notes: resolved.value.notes,
    },
    expectedAnimalVersion: parsed.data.expectedAnimalVersion,
    expectedExperimentVersion: parsed.data.expectedExperimentVersion,
    ...identity,
  });

  if (!result.ok) {
    return commandError(result);
  }

  const saved = result.result as { assignmentId: string; message?: string };
  const reservation = await getExperimentAssignmentApiRecordById(saved.assignmentId, auth.user);

  if (!reservation) {
    return buildApiErrorResponse("Reservation was synced but could not be read back.", 500);
  }

  return buildMutationResponse(reservation, {
    status: result.replayed ? 200 : 201,
    created: !result.replayed,
    message: saved.message ?? "Experiment reservation saved.",
  });
}

function commandIdentity(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  const requestId = request.headers.get("x-request-id")?.trim();
  return idempotencyKey && requestId ? { idempotencyKey, requestId } : null;
}

function commandError(result: { code?: string; message?: string }) {
  const status = result.code === "forbidden" ? 403
    : result.code === "not_found" ? 404
      : [
          "stale_conflict",
          "idempotency_conflict",
          "command_in_progress",
          "duplicate_assignment",
          "reservation_conflict",
          "invalid_snapshot",
        ].includes(result.code ?? "") ? 409
        : result.code === "unexpected_error" ? 500
          : 400;
  return buildApiErrorResponse(result.message ?? "The reservation command failed.", status);
}

async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
