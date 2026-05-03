import { z } from "zod";

import {
  buildApiErrorResponse,
  buildCollectionResponse,
  buildMutationResponse,
  compactApiMeta,
  requireApiUser,
} from "@/lib/api-route";
import { createAnimalRecord, updateAnimalLifecycleStatus } from "@/lib/colony-write";
import {
  getAnimalApiList,
  getAnimalApiRecordById,
  getExistingAnimalApiRecord,
  parseAnimalApiFilters,
  resolveAnimalByApiReference,
  resolveCageByApiReference,
  resolveProjectByApiReference,
  resolveStrainByApiReference,
} from "@/lib/integration-api";

const createAnimalApiSchema = z.object({
  animalCode: z.string().trim().min(3).max(40),
  labId: z.string().trim().min(3).max(40),
  sex: z.enum(["male", "female", "unknown"]),
  dob: z.string().trim().min(1),
  strainId: z.string().trim().min(1).optional(),
  strainName: z.string().trim().min(1).optional(),
  cageId: z.string().trim().min(1).optional(),
  cageBarcode: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  projectCode: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(400).optional(),
});

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

export async function POST(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only" || auth.user.role === "researcher") {
    return buildApiErrorResponse("Your role cannot create new animal records.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = createAnimalApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid animal intake payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const [cage, strain, project] = await Promise.all([
    resolveCageByApiReference(parsed.data),
    resolveStrainByApiReference(parsed.data),
    parsed.data.projectId || parsed.data.projectCode ? resolveProjectByApiReference(parsed.data) : Promise.resolve(null),
  ]);

  if (!cage.ok) {
    return buildApiErrorResponse(cage.message, cage.status);
  }

  if (!strain.ok) {
    return buildApiErrorResponse(strain.message, strain.status);
  }

  if (project && !project.ok) {
    return buildApiErrorResponse(project.message, project.status);
  }

  const existingAnimal = await getExistingAnimalApiRecord({
    animalCode: parsed.data.animalCode,
    labId: parsed.data.labId,
    cageId: cage.value.cageId,
    strainId: strain.value.strainId,
    projectId: project?.value.projectId,
  });

  if (existingAnimal) {
    return buildMutationResponse(existingAnimal, {
      status: 200,
      created: false,
      message: `${parsed.data.animalCode} already matches the submitted animal intake record.`,
    });
  }

  const result = await createAnimalRecord(
    {
      animalId: parsed.data.animalCode,
      labId: parsed.data.labId,
      sex: parsed.data.sex,
      dob: parsed.data.dob,
      strainId: strain.value.strainId,
      cageId: cage.value.cageId,
      projectId: project?.value.projectId,
      notes: parsed.data.notes,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok) {
    const status = result.message.includes("role cannot")
      ? 403
      : result.message.includes("already exists")
        ? 409
        : 400;

    return buildApiErrorResponse(result.message, status);
  }

  if (!result.entityId) {
    return buildApiErrorResponse("Animal record was created but could not be read back.", 500);
  }

  const animal = await getAnimalApiRecordById(result.entityId);

  if (!animal) {
    return buildApiErrorResponse("Animal record was created but could not be read back.", 500);
  }

  return buildMutationResponse(animal, {
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
