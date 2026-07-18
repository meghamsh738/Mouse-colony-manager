import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { addCageHealthNote } from "@/lib/colony-write";
import {
  getCageHealthNoteApiRecordById,
  getExistingCageHealthNoteApiRecord,
  resolveCageByApiReference,
} from "@/lib/integration-api";
import { isReservedQuarantineHealthAction } from "@/lib/quarantine-state-machine";

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
  actionTaken: z.string().trim().max(300).refine(
    (value) => !isReservedQuarantineHealthAction(value),
    "That action label is reserved for the quarantine observation workflow.",
  ).optional(),
  attachmentLabel: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser("cages:manage");

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot add cage health notes.", 403);
  }

  const parsedRequest = await parseCageHealthNoteApiRequest(request);

  if (!parsedRequest.ok) {
    return buildApiErrorResponse(parsedRequest.message, 400, parsedRequest.details);
  }

  const parsed = parsedRequest.value;

  const resolved = await resolveCageByApiReference(parsed, auth.user);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const existingNote = await getExistingCageHealthNoteApiRecord({
    cageId: resolved.value.cageId,
    createdById: auth.user.id,
    noteType: parsed.noteType,
    severity: parsed.severity,
    note: parsed.note,
    followupRequired: parsed.followupRequired,
    actionTaken: parsed.actionTaken,
  }, auth.user);

  if (existingNote && !parsedRequest.attachment) {
    return buildMutationResponse(existingNote, {
      status: 200,
      created: false,
      message: `Health note is already logged for ${existingNote.cageBarcode}.`,
    });
  }

  const result = await addCageHealthNote(
    {
      cageId: resolved.value.cageId,
      noteType: parsed.noteType,
      severity: parsed.severity,
      note: parsed.note,
      followupRequired: parsed.followupRequired,
      actionTaken: parsed.actionTaken,
      attachment: parsedRequest.attachment
        ? {
            file: parsedRequest.attachment,
            label: parsed.attachmentLabel,
          }
        : undefined,
    },
    { id: auth.user.id, role: auth.user.role, activeLabId: auth.user.activeLabId },
  );

  if (!result.ok || !result.entityId) {
    const status = result.message.includes("role cannot") ? 403 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const healthNote = await getCageHealthNoteApiRecordById(result.entityId, auth.user);

  if (!healthNote) {
    return buildApiErrorResponse("Health note was logged but could not be read back.", 500);
  }

  return buildMutationResponse(healthNote, {
    status: existingNote ? 200 : 201,
    created: !existingNote,
    message: result.message,
  });
}

async function parseCageHealthNoteApiRequest(request: Request): Promise<
  | {
      ok: true;
      value: z.infer<typeof cageHealthNoteApiSchema>;
      attachment?: File;
    }
  | {
      ok: false;
      message: string;
      details?: unknown;
    }
> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("multipart/form-data")) {
    try {
      const formData = await request.formData();
      const attachmentField = formData.get("attachment");
      const attachment = attachmentField instanceof File && attachmentField.size > 0 ? attachmentField : undefined;
      const parsed = cageHealthNoteApiSchema.safeParse({
        cageId: getFormText(formData, "cageId"),
        cageBarcode: getFormText(formData, "cageBarcode"),
        noteType: getFormText(formData, "noteType"),
        severity: getFormText(formData, "severity"),
        note: getFormText(formData, "note"),
        followupRequired: parseFormBoolean(formData.get("followupRequired")),
        actionTaken: getFormText(formData, "actionTaken"),
        attachmentLabel: getFormText(formData, "attachmentLabel"),
      });

      if (!parsed.success) {
        return {
          ok: false,
          message: "Invalid cage health-note payload.",
          details: parsed.error.flatten().fieldErrors,
        };
      }

      return {
        ok: true,
        value: parsed.data,
        attachment,
      };
    } catch {
      return { ok: false, message: "Invalid cage health-note payload." };
    }
  }

  try {
    const parsed = cageHealthNoteApiSchema.safeParse(await request.json());

    if (!parsed.success) {
      return {
        ok: false,
        message: "Invalid cage health-note payload.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    return {
      ok: true,
      value: parsed.data,
    };
  } catch {
    return { ok: false, message: "Invalid cage health-note payload." };
  }
}

function getFormText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseFormBoolean(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return false;
  }

  return value === "true" || value === "1" || value === "on";
}
