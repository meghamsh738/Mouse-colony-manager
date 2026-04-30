import { z } from "zod";

import {
  buildApiErrorResponse,
  buildCollectionResponse,
  buildMutationResponse,
  compactApiMeta,
  requireApiUser,
} from "@/lib/api-route";
import { createSampleRecord } from "@/lib/colony-write";
import {
  getSampleApiList,
  getSampleApiRecordById,
  getSampleApiRecordByLabel,
  parseSampleApiFilters,
  resolveSampleApiInput,
} from "@/lib/integration-api";

const createSampleApiSchema = z.object({
  animalId: z.string().trim().min(1).optional(),
  animalCode: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  projectCode: z.string().trim().min(1).optional(),
  sampleLabel: z.string().trim().min(3).max(80),
  sampleType: z.string().trim().min(2).max(80),
  status: z.enum(["collected", "stored", "allocated", "consumed", "discarded"]).default("stored"),
  collectedAt: z.string().trim().min(1),
  storageLocation: z.string().trim().max(120).optional(),
  quantityLabel: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(400).optional(),
});

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  const filters = parseSampleApiFilters(new URL(request.url).searchParams);
  const result = await getSampleApiList(filters);

  return buildCollectionResponse(result.data, {
    total: result.total,
    limit: filters.limit,
    filters: compactApiMeta({
      search: filters.search || undefined,
      status: filters.status !== "all" ? filters.status : undefined,
      animalCode: filters.animalCode || undefined,
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
    return buildApiErrorResponse("Your role cannot record new sample inventory.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = createSampleApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid sample payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveSampleApiInput(parsed.data);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const existingRecord = await getSampleApiRecordByLabel(parsed.data.sampleLabel.trim());

  if (existingRecord) {
    if (existingRecord.animalId !== resolved.value.animalId) {
      return buildApiErrorResponse("Sample label already exists for a different animal.", 409);
    }

    return buildMutationResponse(existingRecord, {
      status: 200,
      created: false,
      message: `Sample ${existingRecord.sampleLabel} is already recorded for ${existingRecord.animalCode}.`,
    });
  }

  const result = await createSampleRecord(
    {
      animalId: resolved.value.animalId,
      projectId: resolved.value.projectId,
      sampleLabel: parsed.data.sampleLabel,
      sampleType: parsed.data.sampleType,
      status: parsed.data.status,
      collectedAt: parsed.data.collectedAt,
      storageLocation: parsed.data.storageLocation,
      quantityLabel: parsed.data.quantityLabel,
      notes: parsed.data.notes,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok || !result.entityId) {
    const status = result.message.includes("role cannot") ? 403 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const sample = await getSampleApiRecordById(result.entityId);

  if (!sample) {
    return buildApiErrorResponse("Sample was created but could not be read back.", 500);
  }

  return buildMutationResponse(sample, {
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
