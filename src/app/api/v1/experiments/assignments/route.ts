import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { planExperimentCohortAssignments } from "@/lib/colony-write";
import {
  getExperimentAssignmentApiRecords,
  resolveExperimentAssignmentApiInput,
} from "@/lib/integration-api";

const assignmentSyncSchema = z.object({
  experimentId: z.string().trim().min(1).optional(),
  experimentCode: z.string().trim().min(1).optional(),
  startDate: z.string().trim().min(1),
  notes: z.string().trim().max(400).optional(),
  assignments: z.array(
    z.object({
      animalId: z.string().trim().min(1).optional(),
      animalCode: z.string().trim().min(1).optional(),
      treatmentGroup: z.string().trim().max(80).optional(),
    }),
  ).min(1).max(100),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot sync experiment assignments.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = assignmentSyncSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid experiment assignment payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveExperimentAssignmentApiInput(parsed.data);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const animalIds = resolved.value.assignments.map((assignment) => assignment.animalId);
  const existingAssignments = await getExperimentAssignmentApiRecords({
    experimentId: resolved.value.experimentId,
    animalIds,
  });

  if (existingAssignments.length === animalIds.length) {
    return buildMutationResponse(existingAssignments, {
      status: 200,
      created: false,
      message: `${resolved.value.experimentCode} already has assignments for the submitted animals.`,
    });
  }

  const result = await planExperimentCohortAssignments(
    {
      experimentId: resolved.value.experimentId,
      startDate: parsed.data.startDate,
      notes: parsed.data.notes,
      selectedAnimals: resolved.value.assignments.map((assignment) => ({
        animalId: assignment.animalCode,
        treatmentGroup: assignment.treatmentGroup,
      })),
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok) {
    const status = result.message.includes("role cannot") ? 403 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const assignments = await getExperimentAssignmentApiRecords({
    experimentId: resolved.value.experimentId,
    animalIds,
  });

  if (!assignments.length) {
    return buildApiErrorResponse("Assignments were synced but could not be read back.", 500);
  }

  return buildMutationResponse(assignments, {
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
