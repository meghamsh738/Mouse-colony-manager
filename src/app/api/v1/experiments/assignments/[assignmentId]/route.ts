import { z } from "zod";

import {
  buildApiErrorResponse,
  buildItemResponse,
  buildMutationResponse,
  buildNotFoundResponse,
  requireApiUser,
} from "@/lib/api-route";
import {
  deletePlannedExperimentAssignment,
  updatePlannedExperimentAssignment,
} from "@/lib/colony-write";
import { getExperimentAssignmentApiRecordById } from "@/lib/integration-api";

const updatePlannedAssignmentSchema = z.object({
  startDate: z.string().trim().min(1),
  treatmentGroup: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(400).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  const { assignmentId } = await params;
  const assignment = await getExperimentAssignmentApiRecordById(assignmentId);

  if (!assignment) {
    return buildNotFoundResponse("Experiment assignment", assignmentId);
  }

  return buildItemResponse(assignment);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot edit planned cohorts.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = updatePlannedAssignmentSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid planned assignment update payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const { assignmentId } = await params;
  const existingAssignment = await getExperimentAssignmentApiRecordById(assignmentId);

  if (!existingAssignment) {
    return buildNotFoundResponse("Experiment assignment", assignmentId);
  }

  if (existingAssignment.status !== "planned") {
    return buildApiErrorResponse("Only planned assignments can be edited.", 400);
  }

  const result = await updatePlannedExperimentAssignment(
    {
      assignmentId,
      ...parsed.data,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok) {
    const status = result.message.includes("role cannot") ? 403 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const assignment = await getExperimentAssignmentApiRecordById(assignmentId);

  if (!assignment) {
    return buildApiErrorResponse("Assignment was updated but could not be read back.", 500);
  }

  return buildMutationResponse(assignment, {
    status: 200,
    created: false,
    message: result.message,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot remove planned cohorts.", 403);
  }

  const { assignmentId } = await params;
  const existingAssignment = await getExperimentAssignmentApiRecordById(assignmentId);

  if (!existingAssignment) {
    return buildNotFoundResponse("Experiment assignment", assignmentId);
  }

  if (existingAssignment.status !== "planned") {
    return buildApiErrorResponse("Only planned assignments can be removed.", 400);
  }

  const result = await deletePlannedExperimentAssignment(
    { assignmentId },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok) {
    const status = result.message.includes("role cannot") ? 403 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  return buildMutationResponse(existingAssignment, {
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
