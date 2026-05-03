import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { recordBreedingLitter } from "@/lib/colony-write";
import { getExistingLitterApiRecord, getLitterApiRecordById } from "@/lib/integration-api";

const createLitterApiSchema = z.object({
  breedingSetupId: z.string().trim().min(1),
  birthDate: z.string().trim().min(1),
  litterSizeBirth: z.coerce.number().int().min(1).max(24),
  notes: z.string().trim().max(400).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();

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

  const existingRecord = await getExistingLitterApiRecord(parsed.data);

  if (existingRecord) {
    return buildMutationResponse(existingRecord, {
      status: 200,
      created: false,
      message: `${existingRecord.id} already matches the submitted litter record.`,
    });
  }

  const result = await recordBreedingLitter(parsed.data, { id: auth.user.id, role: auth.user.role });

  if (!result.ok) {
    const status = result.message.includes("role cannot")
      ? 403
      : result.message.includes("not found")
        ? 404
        : 400;

    return buildApiErrorResponse(result.message, status);
  }

  if (!result.entityId) {
    return buildApiErrorResponse("Litter was recorded but could not be read back.", 500);
  }

  const record = await getLitterApiRecordById(result.entityId);

  if (!record) {
    return buildApiErrorResponse("Litter was recorded but could not be read back.", 500);
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
