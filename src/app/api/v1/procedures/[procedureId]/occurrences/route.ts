import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { getProcedurePlanById } from "@/lib/procedure-read";
import { executeRecordProcedureOccurrenceCommand } from "@/lib/procedure-write";

const occurrenceSchema = z.object({
  labId: z.string().trim().min(1),
  occurrenceKey: z.string().trim().min(1).max(120),
  occurredAt: z.string().trim().min(1),
  status: z.enum(["completed", "not_performed", "aborted"]),
  outcomeNote: z.string().trim().max(500).optional(),
  expectedVersion: z.number().int().positive(),
});

export async function GET(_: Request, context: { params: Promise<{ procedureId: string }> }) {
  const auth = await requireApiUser("procedures:operational");
  if ("response" in auth) return auth.response;
  const { procedureId } = await context.params;
  const plan = await getProcedurePlanById(auth.user, procedureId);
  if (!plan) return buildApiErrorResponse("Procedure plan not found.", 404);
  return Response.json({ data: plan.occurrences, meta: { total: plan.occurrences.length, planId: plan.id } });
}

export async function POST(request: Request, context: { params: Promise<{ procedureId: string }> }) {
  const auth = await requireApiUser("procedures:execute");
  if ("response" in auth) return auth.response;
  const identity = commandIdentity(request);
  if (!identity) return buildApiErrorResponse("Idempotency-Key and X-Request-Id headers are required.", 400);
  const parsed = occurrenceSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) return buildApiErrorResponse("Invalid procedure occurrence payload.", 400, parsed.error.flatten().fieldErrors);
  const { procedureId } = await context.params;
  const { expectedVersion, ...fields } = parsed.data;
  const result = await executeRecordProcedureOccurrenceCommand({
    actor: auth.user,
    command: { planId: procedureId, ...fields },
    expectedVersion,
    ...identity,
  });
  if (!result.ok) return commandError(result);
  const saved = result.result as { occurrenceId: string; message?: string };
  const plan = await getProcedurePlanById(auth.user, procedureId);
  const occurrence = plan?.occurrences.find((candidate) => candidate.id === saved.occurrenceId);
  if (!occurrence) return buildApiErrorResponse("Procedure outcome was recorded but could not be read back.", 500);
  return buildMutationResponse(occurrence, {
    status: result.replayed ? 200 : 201,
    created: !result.replayed,
    message: saved.message ?? "Procedure outcome recorded.",
  });
}

function commandIdentity(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  const requestId = request.headers.get("x-request-id")?.trim();
  return idempotencyKey && requestId ? { idempotencyKey, requestId } : null;
}

function commandError(result: { code?: string; message?: string }) {
  const status = result.code === "forbidden" ? 403
    : result.code === "not_found" ? 404
      : ["stale_conflict", "idempotency_conflict", "command_in_progress", "invalid_snapshot"].includes(result.code ?? "") ? 409
        : result.code === "unexpected_error" ? 500 : 400;
  return buildApiErrorResponse(result.message ?? "Procedure command failed.", status);
}

async function parseJsonBody(request: Request) {
  try { return await request.json(); } catch { return null; }
}
