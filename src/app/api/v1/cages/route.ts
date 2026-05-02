import { z } from "zod";

import {
  buildApiErrorResponse,
  buildCollectionResponse,
  buildMutationResponse,
  compactApiMeta,
  requireApiUser,
} from "@/lib/api-route";
import { moveCageLocation } from "@/lib/colony-write";
import {
  getCageApiList,
  getCageApiRecordById,
  parseCageApiFilters,
  resolveCageMoveApiInput,
} from "@/lib/integration-api";

const moveCageApiSchema = z.object({
  cageId: z.string().trim().min(1).optional(),
  cageBarcode: z.string().trim().min(1).optional(),
  roomId: z.string().trim().min(1).optional(),
  roomNumber: z.string().trim().min(1).optional(),
  rackId: z.string().trim().min(1).optional(),
  rackNumber: z.string().trim().min(1).optional(),
  cageNumber: z.string().trim().min(1).max(12),
  movedAt: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(300),
});

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  const filters = parseCageApiFilters(new URL(request.url).searchParams);
  const result = await getCageApiList(filters);

  return buildCollectionResponse(result.data, {
    total: result.total,
    limit: filters.limit,
    filters: compactApiMeta({
      search: filters.search || undefined,
      status: filters.status !== "all" ? filters.status : undefined,
      room: filters.room || undefined,
      rack: filters.rack || undefined,
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
    return buildApiErrorResponse("Your role cannot move cages.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = moveCageApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid cage move payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveCageMoveApiInput(parsed.data);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const result = await moveCageLocation(
    {
      cageId: resolved.value.cageId,
      roomId: resolved.value.roomId,
      rackId: resolved.value.rackId,
      cageNumber: parsed.data.cageNumber,
      movedAt: parsed.data.movedAt,
      reason: parsed.data.reason,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok || !result.entityId) {
    const status = result.message.includes("role cannot")
      ? 403
      : result.message.includes("not found")
        ? 404
        : result.message.includes("already assigned")
          ? 409
          : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const cage = await getCageApiRecordById(resolved.value.cageId);

  if (!cage) {
    return buildApiErrorResponse("Cage move was recorded but the updated cage could not be read back.", 500);
  }

  return buildMutationResponse(cage, {
    status: 200,
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
