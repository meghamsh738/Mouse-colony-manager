import { z } from "zod";

import { buildApiErrorResponse, buildCollectionResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { getProcedurePlanById, getProcedureWorkspace } from "@/lib/procedure-read";
import { executeCreateProcedurePlanCommand } from "@/lib/procedure-write";

const createPlanSchema = z.object({
  planId: z.string().trim().min(16),
  labId: z.string().trim().min(1),
  assignmentId: z.string().trim().min(1),
  sopAssignmentId: z.string().trim().min(1),
  procedureCode: z.string().trim().min(2).max(80),
  title: z.string().trim().min(2).max(160),
  scheduledAt: z.string().trim().min(1),
  expectedAssignmentVersion: z.number().int().positive(),
  expectedExperimentVersion: z.number().int().positive(),
});
const statusSchema = z.enum(["all", "planned", "completed", "cancelled"]);

export async function GET(request: Request) {
  const auth = await requireApiUser("procedures:operational");
  if ("response" in auth) return auth.response;
  const params = new URL(request.url).searchParams;
  const status = statusSchema.safeParse(params.get("status") ?? "all");
  if (!status.success) return buildApiErrorResponse("Invalid procedure status filter.", 400);
  const workspace = await getProcedureWorkspace(auth.user, {
    search: params.get("search") ?? "",
    status: status.data,
  });
  return buildCollectionResponse(workspace.rows, { total: workspace.rows.length });
}

export async function POST(request: Request) {
  const auth = await requireApiUser("procedures:plan");
  if ("response" in auth) return auth.response;
  const identity = commandIdentity(request);
  if (!identity) return buildApiErrorResponse("Idempotency-Key and X-Request-Id headers are required.", 400);
  const parsed = createPlanSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) return buildApiErrorResponse("Invalid procedure plan payload.", 400, parsed.error.flatten().fieldErrors);
  const { expectedAssignmentVersion, expectedExperimentVersion, ...command } = parsed.data;
  const result = await executeCreateProcedurePlanCommand({
    actor: auth.user,
    command,
    expectedAssignmentVersion,
    expectedExperimentVersion,
    ...identity,
  });
  if (!result.ok) return commandError(result);
  const saved = result.result as { planId: string; message?: string };
  const plan = await getProcedurePlanById(auth.user, saved.planId);
  if (!plan) return buildApiErrorResponse("Procedure plan was saved but could not be read back.", 500);
  return buildMutationResponse(plan, {
    status: result.replayed ? 200 : 201,
    created: !result.replayed,
    message: saved.message ?? "Procedure plan saved.",
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
