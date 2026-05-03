import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { createBreedingSetup } from "@/lib/colony-write";
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
  const auth = await requireApiUser();

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

  const resolved = await resolveBreedingSetupApiInput(parsed.data);

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
  });

  if (existingRecord) {
    return buildMutationResponse(existingRecord, {
      status: 200,
      created: false,
      message: `${existingRecord.id} already matches the submitted breeding setup.`,
    });
  }

  const result = await createBreedingSetup(
    {
      sireId: resolved.value.sireId,
      damId: resolved.value.damId,
      startDate: parsed.data.startDate,
      targetGenotype: parsed.data.targetGenotype,
      targetSex: parsed.data.targetSex,
      notes: parsed.data.notes,
      allowOverride: parsed.data.allowOverride,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok) {
    if (result.message.includes("already in an active breeding setup")) {
      const duplicateRecord = await getExistingBreedingSetupApiRecord({
        sireId: resolved.value.sireId,
        damId: resolved.value.damId,
        startDate: parsed.data.startDate,
        targetGenotype: parsed.data.targetGenotype,
        targetSex: parsed.data.targetSex,
        notes: parsed.data.notes,
      });

      if (duplicateRecord) {
        return buildMutationResponse(duplicateRecord, {
          status: 200,
          created: false,
          message: `${duplicateRecord.id} already matches the submitted breeding setup.`,
        });
      }
    }

    const status = result.message.includes("role cannot") || result.message.includes("Only admins")
      ? 403
      : result.message.includes("not found")
        ? 404
        : 400;

    return buildApiErrorResponse(result.message, status);
  }

  if (!result.entityId) {
    return buildApiErrorResponse("Breeding setup was created but could not be read back.", 500);
  }

  const record = await getBreedingSetupApiRecordById(result.entityId);

  if (!record) {
    return buildApiErrorResponse("Breeding setup was created but could not be read back.", 500);
  }

  return buildMutationResponse(record, {
    status: 201,
    created: true,
    message: result.message,
  });
}

async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
