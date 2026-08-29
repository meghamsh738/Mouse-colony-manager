import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { executeRecordBreedingLitterCommand } from "@/lib/colony-write";
import {
  getBreedingSetupApiRecordById,
  getExistingLitterApiRecord,
  getLitterApiRecordById,
} from "@/lib/integration-api";

const createLitterApiSchema = z.object({
  breedingSetupId: z.string().trim().min(1),
  birthDate: z.string().trim().min(1),
  litterSizeBirth: z.coerce.number().int().min(1).max(24),
  notes: z.string().trim().max(400).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser("breeding:manage");

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot record litters.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = createLitterApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid litter payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const breedingSetup = await getBreedingSetupApiRecordById(parsed.data.breedingSetupId, auth.user);

  if (!breedingSetup) {
    return buildApiErrorResponse("Breeding setup not found.", 404);
  }

  const existingRecord = await getExistingLitterApiRecord(parsed.data, auth.user);

  if (existingRecord) {
    return buildMutationResponse(existingRecord, {
      status: 200,
      created: false,
      message: `${existingRecord.id} already matches the submitted litter record.`,
    });
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  const requestId = request.headers.get("x-request-id")?.trim();
  if (!idempotencyKey || !requestId) {
    return buildApiErrorResponse("Idempotency-Key and X-Request-Id headers are required.", 400);
  }
  const result = await executeRecordBreedingLitterCommand({
    command: parsed.data,
    actor: auth.user,
    idempotencyKey,
    requestId,
    expectedVersion: breedingSetup.version,
  });

  if (!result.ok) {
    const message = result.message ?? "Litter could not be recorded.";
    const status = message.includes("role cannot")
      ? 403
      : message.includes("not found")
        ? 404
        : 400;

    return buildApiErrorResponse(message, status);
  }

  const commandResult = result.result && typeof result.result === "object" && !Array.isArray(result.result)
    ? result.result as { entityId?: unknown; message?: unknown }
    : null;
  const entityId = typeof commandResult?.entityId === "string" ? commandResult.entityId : null;
  const message = typeof commandResult?.message === "string" ? commandResult.message : "Litter recorded.";

  if (!entityId) {
    return buildApiErrorResponse("Litter was recorded but could not be read back.", 500);
  }

  const record = await getLitterApiRecordById(entityId, auth.user);

  if (!record) {
    return buildApiErrorResponse("Litter was recorded but could not be read back.", 500);
  }

  return buildMutationResponse(record, {
    status: 201,
    created: true,
    message,
  });
}

async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
