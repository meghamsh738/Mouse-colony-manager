import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { addCageHealthNote } from "@/lib/colony-write";
import {
  getCageHealthNoteApiRecordById,
  getExistingCageHealthNoteApiRecord,
  resolveCageByApiReference,
} from "@/lib/integration-api";

const cageHealthNoteApiSchema = z.object({
  cageId: z.string().trim().min(1).optional(),
  cageBarcode: z.string().trim().min(1).optional(),
  noteType: z.enum([
    "routine_welfare",
    "adverse_effect",
    "veterinary_concern",
    "breeding_concern",
    "underweight",
    "overweight",
    "grooming_issue",
    "aggression",
    "pregnancy_suspicion",
    "delivery_observed",
    "post_procedure_monitoring",
  ]),
  severity: z.enum(["info", "warning", "critical"]),
  note: z.string().trim().min(6).max(500),
  followupRequired: z.boolean().default(false),
  actionTaken: z.string().trim().max(300).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot add cage health notes.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = cageHealthNoteApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid cage health-note payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveCageByApiReference(parsed.data);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const existingNote = await getExistingCageHealthNoteApiRecord({
    cageId: resolved.value.cageId,
    createdById: auth.user.id,
    noteType: parsed.data.noteType,
    severity: parsed.data.severity,
    note: parsed.data.note,
    followupRequired: parsed.data.followupRequired,
    actionTaken: parsed.data.actionTaken,
  });

  if (existingNote) {
    return buildMutationResponse(existingNote, {
      status: 200,
      created: false,
      message: `Health note is already logged for ${existingNote.cageBarcode}.`,
    });
  }

  const result = await addCageHealthNote(
    {
      cageId: resolved.value.cageId,
      noteType: parsed.data.noteType,
      severity: parsed.data.severity,
      note: parsed.data.note,
      followupRequired: parsed.data.followupRequired,
      actionTaken: parsed.data.actionTaken,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok || !result.entityId) {
    const status = result.message.includes("role cannot") ? 403 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const healthNote = await getCageHealthNoteApiRecordById(result.entityId);

  if (!healthNote) {
    return buildApiErrorResponse("Health note was logged but could not be read back.", 500);
  }

  return buildMutationResponse(healthNote, {
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
