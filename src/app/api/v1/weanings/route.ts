import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { executeWeanLitterCommand } from "@/lib/colony-write";
import { canonicalJsonHash } from "@/lib/command-foundation";
import {
  getLitterApiRecordById,
  getWeaningApiRecordByLitterId,
  resolveCageByApiReference,
  resolveStrainByApiReference,
} from "@/lib/integration-api";

const createWeaningApiSchema = z.object({
  litterId: z.string().trim().min(1),
  weanDate: z.string().trim().min(1),
  femaleCount: z.coerce.number().int().min(0).max(24),
  maleCount: z.coerce.number().int().min(0).max(24),
  femaleCageId: z.string().trim().min(1).optional(),
  femaleCageBarcode: z.string().trim().min(1).optional(),
  maleCageId: z.string().trim().min(1).optional(),
  maleCageBarcode: z.string().trim().min(1).optional(),
  strainId: z.string().trim().min(1).optional(),
  strainName: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser("breeding:manage");

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot record litter weaning.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = createWeaningApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid weaning payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const [litter, strain, femaleCage, maleCage] = await Promise.all([
    getLitterApiRecordById(parsed.data.litterId, auth.user),
    resolveStrainByApiReference(parsed.data, auth.user),
    parsed.data.femaleCount > 0
      ? resolveCageByApiReference({
          cageId: parsed.data.femaleCageId,
          cageBarcode: parsed.data.femaleCageBarcode,
        }, auth.user)
      : Promise.resolve(null),
    parsed.data.maleCount > 0
      ? resolveCageByApiReference({
          cageId: parsed.data.maleCageId,
          cageBarcode: parsed.data.maleCageBarcode,
        }, auth.user)
      : Promise.resolve(null),
  ]);

  if (!litter) {
    return buildApiErrorResponse("Litter not found.", 404);
  }

  if (!strain.ok) {
    return buildApiErrorResponse(strain.message, strain.status);
  }

  if (femaleCage && !femaleCage.ok) {
    return buildApiErrorResponse(femaleCage.message, femaleCage.status);
  }

  if (maleCage && !maleCage.ok) {
    return buildApiErrorResponse(maleCage.message, maleCage.status);
  }

  if (
    (femaleCage?.ok && femaleCage.value.labId !== litter.labId) ||
    (maleCage?.ok && maleCage.value.labId !== litter.labId)
  ) {
    return buildApiErrorResponse("Destination cage not found.", 404);
  }

  const command = {
    litterId: parsed.data.litterId,
    weanDate: parsed.data.weanDate,
    femaleCount: parsed.data.femaleCount,
    maleCount: parsed.data.maleCount,
    femaleCageId: femaleCage?.value.cageId,
    maleCageId: maleCage?.value.cageId,
    strainId: strain.value.strainId,
  };
  const idempotencyKey = request.headers.get("idempotency-key")?.trim()
    || canonicalJsonHash({ actorId: auth.user.id, command });
  const result = await executeWeanLitterCommand({
    actor: auth.user,
    command,
    idempotencyKey,
    requestId: request.headers.get("x-request-id")?.trim() || idempotencyKey,
  });

  if (!result.ok) {
    if (
      result.code === "compliance_count_conflict" ||
      result.message?.includes("already has a recorded weaning outcome") ||
      result.message?.includes("already has linked progeny records")
    ) {
      const existingRecord = await getWeaningApiRecordByLitterId(parsed.data.litterId, auth.user);

      if (existingRecord && matchesWeaningInput(existingRecord, parsed.data, strain.value.strainId, femaleCage?.value.cageId, maleCage?.value.cageId)) {
        return buildMutationResponse(existingRecord, {
          status: 200,
          created: false,
          message: `${parsed.data.litterId} already matches the submitted weaning outcome.`,
        });
      }
    }

    const message = result.message ?? "Litter weaning could not be recorded.";
    const status = message.includes("role cannot") || result.code === "forbidden"
      ? 403
      : message.includes("not found")
        ? 404
        : result.code === "idempotency_conflict" || result.code === "command_in_progress"
          ? 409
        : 400;

    return buildApiErrorResponse(message, status);
  }

  const commandResult = result.result && typeof result.result === "object" && !Array.isArray(result.result)
    ? result.result as { entityId?: unknown; message?: unknown }
    : null;
  const entityId = typeof commandResult?.entityId === "string" ? commandResult.entityId : null;
  const message = typeof commandResult?.message === "string"
    ? commandResult.message
    : "Litter weaning recorded.";
  if (!entityId) {
    return buildApiErrorResponse("Litter weaning was recorded but could not be read back.", 500);
  }

  const record = await getWeaningApiRecordByLitterId(entityId, auth.user);

  if (!record) {
    return buildApiErrorResponse("Litter weaning was recorded but could not be read back.", 500);
  }

  return buildMutationResponse(record, {
    status: result.replayed ? 200 : 201,
    created: !result.replayed,
    message: result.replayed
      ? `${parsed.data.litterId} already matches the submitted weaning outcome.`
      : message,
  });
}

function matchesWeaningInput(
  record: {
    weanDate: string | null;
    femaleCount: number;
    maleCount: number;
    strainId: string | null;
    femaleCage: { cageId: string } | null;
    maleCage: { cageId: string } | null;
  },
  input: z.infer<typeof createWeaningApiSchema>,
  strainId: string,
  femaleCageId?: string,
  maleCageId?: string,
) {
  return (
    record.weanDate === input.weanDate &&
    record.femaleCount === input.femaleCount &&
    record.maleCount === input.maleCount &&
    record.strainId === strainId &&
    (input.femaleCount === 0 || record.femaleCage?.cageId === femaleCageId) &&
    (input.maleCount === 0 || record.maleCage?.cageId === maleCageId)
  );
}

async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
