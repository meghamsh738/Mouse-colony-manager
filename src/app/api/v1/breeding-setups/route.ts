import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { executeCreateBreedingSetupCommand } from "@/lib/colony-write";
import { canonicalJsonHash } from "@/lib/command-foundation";
import {
  getBreedingSetupApiRecordById,
  getExistingBreedingSetupApiRecord,
  resolveBreedingSetupApiInput,
} from "@/lib/integration-api";

const createBreedingSetupApiSchema = z.object({
  sireId: z.string().trim().min(1).optional(),
  sireCode: z.string().trim().min(1).optional(),
  damId: z.string().trim().min(1).optional(),
  damCode: z.string().trim().min(1).optional(),
  startDate: z.string().trim().min(1),
  targetGenotype: z.string().trim().min(3).max(200),
  targetSex: z.enum(["male", "female", "unknown"]).optional(),
  notes: z.string().trim().max(400).optional(),
  allowOverride: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser("breeding:manage");

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot create breeding setups.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = createBreedingSetupApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid breeding setup payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveBreedingSetupApiInput(parsed.data, auth.user);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const existingRecord = await getExistingBreedingSetupApiRecord({
    sireId: resolved.value.sireId,
    damId: resolved.value.damId,
    startDate: parsed.data.startDate,
    targetGenotype: parsed.data.targetGenotype,
    targetSex: parsed.data.targetSex,
    notes: parsed.data.notes,
  }, auth.user);

  if (existingRecord) {
    return buildMutationResponse(existingRecord, {
      status: 200,
      created: false,
      message: `${existingRecord.id} already matches the submitted breeding setup.`,
    });
  }

  const command = {
    sireId: resolved.value.sireId,
    damId: resolved.value.damId,
    startDate: parsed.data.startDate,
    targetGenotype: parsed.data.targetGenotype,
    targetSex: parsed.data.targetSex,
    notes: parsed.data.notes,
    allowOverride: parsed.data.allowOverride,
  };
  const idempotencyKey = request.headers.get("idempotency-key")?.trim()
    || canonicalJsonHash({ actorId: auth.user.id, command });
  const result = await executeCreateBreedingSetupCommand({
    actor: auth.user,
    command,
    idempotencyKey,
    requestId: request.headers.get("x-request-id")?.trim() || idempotencyKey,
  });

  if (!result.ok) {
    const errorMessage = result.message ?? "Breeding setup could not be created.";
    if (errorMessage.includes("already in an active breeding setup")) {
      const duplicateRecord = await getExistingBreedingSetupApiRecord({
        sireId: resolved.value.sireId,
        damId: resolved.value.damId,
        startDate: parsed.data.startDate,
        targetGenotype: parsed.data.targetGenotype,
        targetSex: parsed.data.targetSex,
        notes: parsed.data.notes,
      }, auth.user);

      if (duplicateRecord) {
        return buildMutationResponse(duplicateRecord, {
          status: 200,
          created: false,
          message: `${duplicateRecord.id} already matches the submitted breeding setup.`,
        });
      }
    }

    const status = errorMessage.includes("role cannot") || errorMessage.includes("Only admins")
      ? 403
      : errorMessage.includes("not found")
        ? 404
        : 400;

    return buildApiErrorResponse(errorMessage, status);
  }

  const commandResult = result.result && typeof result.result === "object" && !Array.isArray(result.result)
    ? result.result
    : null;
  const entityId = commandResult && "entityId" in commandResult && typeof commandResult.entityId === "string"
    ? commandResult.entityId
    : null;
  const resultMessage = commandResult && "message" in commandResult && typeof commandResult.message === "string"
    ? commandResult.message
    : "Breeding setup created.";

  if (!entityId) {
    return buildApiErrorResponse("Breeding setup was created but could not be read back.", 500);
  }

  const record = await getBreedingSetupApiRecordById(entityId, auth.user);

  if (!record) {
    return buildApiErrorResponse("Breeding setup was created but could not be read back.", 500);
  }

  return buildMutationResponse(record, {
    status: result.replayed ? 200 : 201,
    created: !result.replayed,
    message: resultMessage,
  });
}

async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
