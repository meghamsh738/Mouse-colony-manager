import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { reserveAnimalForExperiment } from "@/lib/colony-write";
import {
  getExistingExperimentReservationApiRecord,
  getExperimentAssignmentApiRecords,
  resolveExperimentReservationApiInput,
} from "@/lib/integration-api";

const experimentReservationSchema = z.object({
  experimentId: z.string().trim().min(1).optional(),
  experimentCode: z.string().trim().min(1).optional(),
  animalId: z.string().trim().min(1).optional(),
  animalCode: z.string().trim().min(1).optional(),
  startDate: z.string().trim().min(1),
  treatmentGroup: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(400).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot sync experiment reservations.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = experimentReservationSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid experiment reservation payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveExperimentReservationApiInput(parsed.data);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const existingReservation = await getExistingExperimentReservationApiRecord({
    experimentId: resolved.value.experimentId,
    animalId: resolved.value.animalId,
    startDate: parsed.data.startDate,
    treatmentGroup: resolved.value.treatmentGroup,
  });

  if (existingReservation) {
    return buildMutationResponse(existingReservation, {
      status: 200,
      created: false,
      message: `${resolved.value.animalCode} is already reserved for ${resolved.value.experimentCode}.`,
    });
  }

  const result = await reserveAnimalForExperiment(
    {
      animalId: resolved.value.animalId,
      experimentId: resolved.value.experimentId,
      startDate: parsed.data.startDate,
      treatmentGroup: resolved.value.treatmentGroup,
      notes: resolved.value.notes,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok) {
    const status = result.message.includes("role cannot") ? 403 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const [reservation] = await getExperimentAssignmentApiRecords({
    experimentId: resolved.value.experimentId,
    animalIds: [resolved.value.animalId],
  });

  if (!reservation) {
    return buildApiErrorResponse("Reservation was synced but could not be read back.", 500);
  }

  return buildMutationResponse(reservation, {
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
