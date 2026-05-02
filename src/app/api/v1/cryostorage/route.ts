import { z } from "zod";

import {
  buildApiErrorResponse,
  buildCollectionResponse,
  buildMutationResponse,
  compactApiMeta,
  requireApiUser,
} from "@/lib/api-route";
import { createCryostorageRecord, updateCryostorageRecord } from "@/lib/colony-write";
import {
  getCryostorageApiList,
  getCryostorageApiRecordById,
  getCryostorageApiRecordByLabel,
  parseCryostorageApiFilters,
  resolveCryostorageApiInput,
  resolveCryostorageApiRecordReference,
} from "@/lib/integration-api";

const createCryostorageApiSchema = z.object({
  strainId: z.string().trim().min(1).optional(),
  strainName: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  projectCode: z.string().trim().min(1).optional(),
  sampleLabel: z.string().trim().min(3).max(80),
  materialType: z.string().trim().min(2).max(80),
  status: z.enum(["stored", "reserved", "recovered", "depleted", "discarded"]).default("stored"),
  storedAt: z.string().trim().min(1),
  storageLocation: z.string().trim().max(120).optional(),
  quantityLabel: z.string().trim().max(80).optional(),
  recoveryNotes: z.string().trim().max(400).optional(),
  notes: z.string().trim().max(400).optional(),
});

const updateCryostorageApiSchema = z.object({
  recordId: z.string().trim().min(1).optional(),
  sampleLabel: z.string().trim().min(3).max(80).optional(),
  status: z.enum(["stored", "reserved", "recovered", "depleted", "discarded"]).optional(),
  storageLocation: z.string().trim().max(120).nullable().optional(),
  quantityLabel: z.string().trim().max(80).nullable().optional(),
  recoveryNotes: z.string().trim().max(400).nullable().optional(),
  notes: z.string().trim().max(400).nullable().optional(),
});

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  const filters = parseCryostorageApiFilters(new URL(request.url).searchParams);
  const result = await getCryostorageApiList(filters);

  return buildCollectionResponse(result.data, {
    total: result.total,
    limit: filters.limit,
    filters: compactApiMeta({
      search: filters.search || undefined,
      status: filters.status !== "all" ? filters.status : undefined,
      strain: filters.strain || undefined,
      projectCode: filters.projectCode || undefined,
    }),
  });
}

export async function POST(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot record cryostorage inventory.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = createCryostorageApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid cryostorage payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveCryostorageApiInput(parsed.data);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const existingRecord = await getCryostorageApiRecordByLabel(parsed.data.sampleLabel.trim());

  if (existingRecord) {
    const sameProject = (existingRecord.projectCode ?? null) === (resolved.value.projectCode ?? null);
    const sameStoredAt = existingRecord.storedAt.slice(0, 10) === parsed.data.storedAt.trim();

    if (
      existingRecord.strainId !== resolved.value.strainId ||
      existingRecord.materialType !== parsed.data.materialType.trim() ||
      existingRecord.status !== parsed.data.status ||
      !sameStoredAt ||
      !sameProject
    ) {
      return buildApiErrorResponse("Cryostorage label already exists with different record details.", 409);
    }

    return buildMutationResponse(existingRecord, {
      status: 200,
      created: false,
      message: `Cryostorage record ${existingRecord.sampleLabel} is already recorded for ${existingRecord.strainName}.`,
    });
  }

  const result = await createCryostorageRecord(
    {
      strainId: resolved.value.strainId,
      projectId: resolved.value.projectId,
      sampleLabel: parsed.data.sampleLabel,
      materialType: parsed.data.materialType,
      status: parsed.data.status,
      storedAt: parsed.data.storedAt,
      storageLocation: parsed.data.storageLocation,
      quantityLabel: parsed.data.quantityLabel,
      recoveryNotes: parsed.data.recoveryNotes,
      notes: parsed.data.notes,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok || !result.entityId) {
    const status = result.message.includes("role cannot") ? 403 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const record = await getCryostorageApiRecordById(result.entityId);

  if (!record) {
    return buildApiErrorResponse("Cryostorage record was created but could not be read back.", 500);
  }

  return buildMutationResponse(record, {
    status: 201,
    created: true,
    message: result.message,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot update cryostorage inventory.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = updateCryostorageApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid cryostorage update payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveCryostorageApiRecordReference(parsed.data);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const result = await updateCryostorageRecord(
    {
      recordId: resolved.value.recordId,
      status: parsed.data.status,
      storageLocation: parsed.data.storageLocation,
      quantityLabel: parsed.data.quantityLabel,
      recoveryNotes: parsed.data.recoveryNotes,
      notes: parsed.data.notes,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok || !result.entityId) {
    const status = result.message.includes("role cannot") ? 403 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const record = await getCryostorageApiRecordById(result.entityId);

  if (!record) {
    return buildApiErrorResponse("Cryostorage record was updated but could not be read back.", 500);
  }

  return buildMutationResponse(record, {
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
