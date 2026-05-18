import { z } from "zod";

import {
  buildApiErrorResponse,
  buildCollectionResponse,
  buildMutationResponse,
  compactApiMeta,
  requireApiUser,
} from "@/lib/api-route";
import { createProjectRecord, updateProjectRecord } from "@/lib/colony-write";
import {
  getProjectApiList,
  getProjectApiRecordByCode,
  getProjectApiRecordById,
  parseProjectApiFilters,
  resolveProjectByApiReference,
  resolveProjectOwnerByApiReference,
} from "@/lib/integration-api";
import type { UserRole } from "@/lib/types";

const createProjectApiSchema = z.object({
  projectCode: z.string().trim().min(3).max(60),
  title: z.string().trim().min(3).max(160),
  ownerId: z.string().trim().min(1).optional(),
  ownerEmail: z.string().trim().email().optional(),
  notes: z.string().trim().max(1000).optional(),
});

const updateProjectApiSchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  projectCode: z.string().trim().min(3).max(60).optional(),
  title: z.string().trim().min(3).max(160).optional(),
  ownerId: z.string().trim().min(1).optional(),
  ownerEmail: z.string().trim().email().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

function canSyncProjects(role: UserRole) {
  return role === "admin" || role === "colony_manager";
}

function normalizeOptionalText(value?: string | null) {
  if (value === undefined) {
    return undefined;
  }

  return value?.trim() || null;
}

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  const filters = parseProjectApiFilters(new URL(request.url).searchParams);
  const result = await getProjectApiList(filters);

  return buildCollectionResponse(result.data, {
    total: result.total,
    limit: filters.limit,
    filters: compactApiMeta({
      search: filters.search || undefined,
      owner: filters.owner || undefined,
    }),
  });
}

export async function POST(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (!canSyncProjects(auth.user.role)) {
    return buildApiErrorResponse("Your role cannot sync project records.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = createProjectApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid project payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const owner = await resolveProjectOwnerByApiReference(parsed.data, auth.user.id);

  if (!owner.ok) {
    return buildApiErrorResponse(owner.message, owner.status);
  }

  const existingProject = await getProjectApiRecordByCode(parsed.data.projectCode);
  const notes = normalizeOptionalText(parsed.data.notes) ?? null;

  if (existingProject) {
    if (
      existingProject.title === parsed.data.title &&
      existingProject.ownerId === owner.value.ownerId &&
      (existingProject.notes ?? null) === notes
    ) {
      return buildMutationResponse(existingProject, {
        status: 200,
        created: false,
        message: `Project ${existingProject.projectCode} already matches the submitted project record.`,
      });
    }

    return buildApiErrorResponse("Project code already exists with different details. Use PATCH to update it.", 409);
  }

  const result = await createProjectRecord(
    {
      projectCode: parsed.data.projectCode,
      title: parsed.data.title,
      ownerId: owner.value.ownerId,
      notes: parsed.data.notes,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok || !result.entityId) {
    const status = result.message.includes("role cannot") ? 403 : result.message.includes("already exists") ? 409 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const project = await getProjectApiRecordById(result.entityId);

  if (!project) {
    return buildApiErrorResponse("Project was created but could not be read back.", 500);
  }

  return buildMutationResponse(project, {
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

  if (!canSyncProjects(auth.user.role)) {
    return buildApiErrorResponse("Your role cannot sync project records.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = updateProjectApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid project update payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const hasUpdate =
    parsed.data.title !== undefined ||
    parsed.data.ownerId !== undefined ||
    parsed.data.ownerEmail !== undefined ||
    parsed.data.notes !== undefined;

  if (!hasUpdate) {
    return buildApiErrorResponse("Provide at least one project field to update.", 400);
  }

  const resolved = await resolveProjectByApiReference(parsed.data);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const owner =
    parsed.data.ownerId || parsed.data.ownerEmail
      ? await resolveProjectOwnerByApiReference(parsed.data, auth.user.id)
      : null;

  if (owner && !owner.ok) {
    return buildApiErrorResponse(owner.message, owner.status);
  }

  const ownerId = owner?.ok ? owner.value.ownerId : undefined;
  const result = await updateProjectRecord(
    {
      projectId: resolved.value.projectId,
      title: parsed.data.title,
      ownerId,
      notes: normalizeOptionalText(parsed.data.notes),
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok || !result.entityId) {
    const status = result.message.includes("role cannot")
      ? 403
      : result.message.includes("not found")
        ? 404
        : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const project = await getProjectApiRecordById(result.entityId);

  if (!project) {
    return buildApiErrorResponse("Project was updated but could not be read back.", 500);
  }

  return buildMutationResponse(project, {
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
