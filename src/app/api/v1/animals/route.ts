import { z } from "zod";

import {
  buildApiErrorResponse,
  buildCollectionResponse,
  buildMutationResponse,
  compactApiMeta,
  requireApiUser,
} from "@/lib/api-route";
import { updateAnimalLifecycleStatus } from "@/lib/colony-write";
import { getAnimalApiList, getAnimalApiRecordById, parseAnimalApiFilters, resolveAnimalByApiReference } from "@/lib/integration-api";

const updateAnimalLifecycleApiSchema = z.object({
  animalId: z.string().trim().min(1).optional(),
  animalCode: z.string().trim().min(1).optional(),
  targetStatus: z.enum(["euthanized", "dead", "transferred_out", "archived"]),
  happenedAt: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(400),
});

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  const filters = parseAnimalApiFilters(new URL(request.url).searchParams);
  const result = await getAnimalApiList(filters);

  return buildCollectionResponse(result.data, {
    total: result.total,
    limit: filters.limit,
    filters: compactApiMeta({
      search: filters.search || undefined,
      status: filters.status !== "all" ? filters.status : undefined,
      sex: filters.sex !== "all" ? filters.sex : undefined,
      strain: filters.strain || undefined,
      projectCode: filters.projectCode || undefined,
      availableOnly: filters.availableOnly ? true : undefined,
      warningsOnly: filters.warningsOnly ? true : undefined,
    }),
  });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only" || auth.user.role === "researcher") {
    return buildApiErrorResponse("Your role cannot change terminal lifecycle states.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = updateAnimalLifecycleApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid animal lifecycle payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveAnimalByApiReference(parsed.data);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const result = await updateAnimalLifecycleStatus(
    {
      animalId: resolved.value.animalId,
      targetStatus: parsed.data.targetStatus,
      happenedAt: parsed.data.happenedAt,
      reason: parsed.data.reason,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok) {
    const status = result.message.includes("role cannot")
      ? 403
      : result.message.includes("not found")
        ? 404
        : 400;

    return buildApiErrorResponse(result.message, status);
  }

  if (!result.entityId) {
    return buildApiErrorResponse("Animal lifecycle state changed but could not be read back.", 500);
  }

  const animal = await getAnimalApiRecordById(result.entityId);

  if (!animal) {
    return buildApiErrorResponse("Animal lifecycle state changed but could not be read back.", 500);
  }

  return buildMutationResponse(animal, {
    status: result.message.includes("already") ? 200 : 200,
    created: false,
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
