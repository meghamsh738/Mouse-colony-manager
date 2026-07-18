import { z } from "zod";

import {
  buildApiErrorResponse,
  buildCollectionResponse,
  buildMutationResponse,
  compactApiMeta,
  requireApiUser,
} from "@/lib/api-route";
import { biosampleReplayMatches } from "@/lib/biosample-idempotency";
import { createSampleRecord, updateSampleRecord } from "@/lib/colony-write";
import {
  getSampleApiList,
  getSampleApiRecordById,
  getSampleApiRecordByLabel,
  parseSampleApiFilters,
  resolveExperimentApiReference,
  resolveSampleApiRecordReference,
  resolveSampleApiInput,
} from "@/lib/integration-api";

const createSampleApiSchema = z.object({
  animalId: z.string().trim().min(1).optional(),
  animalCode: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  projectCode: z.string().trim().min(1).optional(),
  experimentId: z.string().trim().min(1).optional(),
  experimentCode: z.string().trim().min(1).optional(),
  sampleLabel: z.string().trim().min(3).max(80),
  sampleType: z.string().trim().min(2).max(80),
  status: z.enum(["collected", "stored", "allocated", "consumed", "discarded"]).default("stored"),
  collectedAt: z.string().trim().min(1),
  storageLocation: z.string().trim().max(120).optional(),
  quantityLabel: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(400).optional(),
});

const updateSampleApiSchema = z.object({
  sampleId: z.string().trim().min(1).optional(),
  sampleLabel: z.string().trim().min(3).max(80).optional(),
  expectedVersion: z.number().int().positive(),
  experimentId: z.string().trim().min(1).nullable().optional(),
  experimentCode: z.string().trim().min(1).optional(),
  status: z.enum(["collected", "stored", "allocated", "consumed", "discarded"]).optional(),
  storageLocation: z.string().trim().max(120).nullable().optional(),
  quantityLabel: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(400).nullable().optional(),
});

export async function GET(request: Request) {
  const auth = await requireApiUser("biosamples:read");

  if ("response" in auth) {
    return auth.response;
  }

  const filters = parseSampleApiFilters(new URL(request.url).searchParams);
  const result = await getSampleApiList(filters, auth.user);

  return buildCollectionResponse(result.data, {
    total: result.total,
    limit: filters.limit,
    filters: compactApiMeta({
      search: filters.search || undefined,
      status: filters.status !== "all" ? filters.status : undefined,
      animalCode: filters.animalCode || undefined,
      projectCode: filters.projectCode || undefined,
      experimentCode: filters.experimentCode || undefined,
    }),
  });
}

export async function POST(request: Request) {
  const auth = await requireApiUser("biosamples:manage");

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

  const resolved = await resolveSampleApiInput(parsed.data, auth.user);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const existingRecord = await getSampleApiRecordByLabel(parsed.data.sampleLabel.trim(), auth.user);

  if (existingRecord) {
    const equivalent = biosampleReplayMatches(
      {
        animalId: existingRecord.animalId,
        labId: existingRecord.labId,
        projectRef: existingRecord.projectCode,
        experimentId: existingRecord.experimentId,
        sampleLabel: existingRecord.sampleLabel,
        sampleType: existingRecord.sampleType,
        status: existingRecord.status,
        collectedAt: existingRecord.collectedAt,
        storageLocation: existingRecord.storageLocation,
        quantityLabel: existingRecord.quantityLabel,
        notes: existingRecord.notes,
      },
      {
        animalId: resolved.value.animalId,
        labId: resolved.value.labId,
        projectRef: resolved.value.projectCode,
        experimentId: resolved.value.experimentId,
        sampleLabel: parsed.data.sampleLabel,
        sampleType: parsed.data.sampleType,
        status: parsed.data.status,
        collectedAt: parsed.data.collectedAt,
        storageLocation: parsed.data.storageLocation,
        quantityLabel: parsed.data.quantityLabel,
        notes: parsed.data.notes,
      },
    );
    if (!equivalent) {
      return buildApiErrorResponse("Sample label already exists with different inventory or provenance data.", 409);
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
      experimentId: resolved.value.experimentId,
      sampleLabel: parsed.data.sampleLabel,
      sampleType: parsed.data.sampleType,
      status: parsed.data.status,
      collectedAt: parsed.data.collectedAt,
      storageLocation: parsed.data.storageLocation,
      quantityLabel: parsed.data.quantityLabel,
      notes: parsed.data.notes,
    },
    { id: auth.user.id, role: auth.user.role, activeLabId: auth.user.activeLabId },
  );

  if (!result.ok || !result.entityId) {
    const status = result.message.includes("role cannot") ? 403 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const sample = await getSampleApiRecordById(result.entityId, auth.user);

  if (!sample) {
    return buildApiErrorResponse("Sample was created but could not be read back.", 500);
  }

  return buildMutationResponse(sample, {
    status: 201,
    created: true,
    message: result.message,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser("biosamples:manage");

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot update sample inventory.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = updateSampleApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid sample update payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveSampleApiRecordReference(parsed.data, auth.user);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  let experimentId: string | null | undefined;
  if (parsed.data.experimentId === null) {
    experimentId = null;
  } else if (parsed.data.experimentId || parsed.data.experimentCode) {
    const experiment = await resolveExperimentApiReference(
      {
        experimentId: parsed.data.experimentId ?? undefined,
        experimentCode: parsed.data.experimentCode,
      },
      auth.user,
    );
    if (!experiment.ok) {
      return buildApiErrorResponse(experiment.message, experiment.status);
    }
    experimentId = experiment.value.experimentId;
  }

  const result = await updateSampleRecord(
    {
      sampleId: resolved.value.sampleId,
      expectedVersion: parsed.data.expectedVersion,
      experimentId,
      status: parsed.data.status,
      storageLocation: parsed.data.storageLocation,
      quantityLabel: parsed.data.quantityLabel,
      notes: parsed.data.notes,
    },
    { id: auth.user.id, role: auth.user.role, activeLabId: auth.user.activeLabId },
  );

  if (!result.ok || !result.entityId) {
    const status = result.message.includes("role cannot")
      ? 403
      : result.message.includes("changed after")
        ? 409
        : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const sample = await getSampleApiRecordById(result.entityId, auth.user);

  if (!sample) {
    return buildApiErrorResponse("Sample was updated but could not be read back.", 500);
  }

  return buildMutationResponse(sample, {
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
