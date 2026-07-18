import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  buildApiErrorResponse,
  buildCollectionResponse,
  buildMutationResponse,
  compactApiMeta,
  requireApiUser,
} from "@/lib/api-route";
import { createAnimalRecord, executeUpdateAnimalLifecycleCommand } from "@/lib/colony-write";
import { canonicalJsonHash, prepareWorkflowReview } from "@/lib/command-foundation";
import { parseExactLifecycleTimestamp } from "@/lib/lifecycle-provenance";
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
  happenedAt: z.string().trim().min(1).max(40),
  reason: z.string().trim().min(3).max(400),
  destination: z.string().trim().max(160).optional(),
  transferReference: z.string().trim().max(120).optional(),
  sopAssignmentId: z.string().trim().min(1).optional(),
  expectedVersion: z.coerce.number().int().min(1),
  confirmed: z.literal(true),
}).superRefine((value, context) => {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.happenedAt);
  const exactDateTime = Boolean(parseExactLifecycleTimestamp(value.happenedAt));
  if (value.targetStatus === "euthanized" && !exactDateTime) {
    context.addIssue({ code: "custom", path: ["happenedAt"], message: "Euthanasia requires an exact date and time with a timezone." });
  }
  if (value.targetStatus !== "euthanized" && !dateOnly) {
    context.addIssue({ code: "custom", path: ["happenedAt"], message: "Choose a lifecycle date." });
  }
  if (value.targetStatus === "transferred_out" && !value.destination) {
    context.addIssue({ code: "custom", path: ["destination"], message: "A receiving facility is required." });
  }
  if (value.targetStatus !== "transferred_out" && (value.destination || value.transferReference)) {
    context.addIssue({ code: "custom", path: ["destination"], message: "Transfer fields only apply to a transferred-out disposition." });
  }
  if (value.targetStatus === "euthanized" && !value.sopAssignmentId) {
    context.addIssue({ code: "custom", path: ["sopAssignmentId"], message: "An approved assigned SOP is required for euthanasia." });
  }
  if (value.targetStatus !== "euthanized" && value.sopAssignmentId) {
    context.addIssue({ code: "custom", path: ["sopAssignmentId"], message: "SOP provenance only applies to euthanasia." });
  }
});

export async function GET(request: Request) {
  const auth = await requireApiUser("animals:read");

  if ("response" in auth) {
    return auth.response;
  }

  const filters = parseAnimalApiFilters(new URL(request.url).searchParams);
  const result = await getAnimalApiList(filters, auth.user);

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
  const auth = await requireApiUser("animals:manage");

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
    resolveCageByApiReference(parsed.data, auth.user),
    resolveStrainByApiReference(parsed.data, auth.user),
    parsed.data.projectId || parsed.data.projectCode
      ? resolveProjectByApiReference(parsed.data, auth.user)
      : Promise.resolve(null),
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

  if (project?.ok && project.value.labId !== cage.value.labId) {
    return buildApiErrorResponse("Project not found for the supplied projectId or projectCode.", 404);
  }

  const existingAnimal = await getExistingAnimalApiRecord({
    animalCode: parsed.data.animalCode,
    labId: parsed.data.labId,
    cageId: cage.value.cageId,
    strainId: strain.value.strainId,
    projectId: project?.value.projectId,
  }, auth.user);

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
    { id: auth.user.id, role: auth.user.role, activeLabId: auth.user.activeLabId },
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

  const animal = await getAnimalApiRecordById(result.entityId, auth.user);

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
  const auth = await requireApiUser("animals:manage");

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

  const resolved = await resolveAnimalByApiReference(parsed.data, auth.user);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const current = await getAnimalApiRecordById(resolved.value.animalId, auth.user);
  if (!current) return buildApiErrorResponse("Animal not found.", 404);
  const command = {
    animalId: resolved.value.animalId,
    targetStatus: parsed.data.targetStatus,
    happenedAt: parsed.data.happenedAt,
    reason: parsed.data.reason,
    destination: parsed.data.destination,
    transferReference: parsed.data.transferReference,
    sopAssignmentId: parsed.data.sopAssignmentId,
  };
  const expectedVersion = parsed.data.expectedVersion;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim()
    || canonicalJsonHash({ actorId: auth.user.id, command, expectedVersion });
  const workflowDraftId = request.headers.get("x-workflow-id")?.trim() || `lifecycle-${idempotencyKey}`;
  const review = await prepareWorkflowReview({
    actor: auth.user,
    draftId: workflowDraftId,
    workflowType: "animal.lifecycle.api",
    requiredCapability: "animals:manage",
    labId: auth.user.canonicalRole === "lab_user" ? auth.user.activeLabId : null,
    payload: { command, expectedVersion } as unknown as Prisma.InputJsonValue,
    allowCommittedReplay: true,
  });
  if (!review.ok) return buildApiErrorResponse(review.message, 409);
  const result = await executeUpdateAnimalLifecycleCommand({
    actor: auth.user,
    command,
    expectedVersion,
    idempotencyKey,
    requestId: request.headers.get("x-request-id")?.trim() || review.snapshot.id,
    workflowDraftId: review.draft.id,
    reviewSnapshotId: review.snapshot.id,
  });

  if (!result.ok) {
    const errorMessage = result.message ?? "Animal lifecycle state could not be changed.";
    const status = result.code === "idempotency_conflict" || result.code === "stale_conflict"
      ? 409
      : errorMessage.includes("role cannot")
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
    : "Animal lifecycle state changed.";
  if (!entityId) {
    return buildApiErrorResponse("Animal lifecycle state changed but could not be read back.", 500);
  }

  const animal = await getAnimalApiRecordById(entityId, auth.user);

  if (!animal) {
    return buildApiErrorResponse("Animal lifecycle state changed but could not be read back.", 500);
  }

  return buildMutationResponse(animal, {
    status: 200,
    created: false,
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
