import { z } from "zod";

import { buildApiErrorResponse, buildCollectionResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { updateRuleConfig } from "@/lib/colony-write";
import {
  getRuleApiList,
  getRuleApiRecordById,
  parseRuleApiFilters,
  resolveRuleApiReference,
} from "@/lib/integration-api";

const updateRuleApiSchema = z.object({
  ruleId: z.string().trim().min(1).optional(),
  ruleKey: z.string().trim().min(1).optional(),
  valueInput: z.string(),
  criticalBlock: z.boolean().optional(),
});

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  const filters = parseRuleApiFilters(new URL(request.url).searchParams);
  const result = await getRuleApiList(filters);

  return buildCollectionResponse(result.data, {
    total: result.total,
    limit: filters.limit,
    filters: {
      search: filters.search,
      category: filters.category,
      criticalOnly: filters.criticalOnly,
      limit: filters.limit,
    },
  });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role !== "admin") {
    return buildApiErrorResponse("Only admins can update rule settings.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = updateRuleApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid rule update payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveRuleApiReference(parsed.data);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const existingRule = await getRuleApiRecordById(resolved.value.ruleId);

  if (!existingRule) {
    return buildApiErrorResponse("Rule was resolved but could not be read back.", 500);
  }

  const result = await updateRuleConfig(
    {
      ruleId: resolved.value.ruleId,
      valueInput: parsed.data.valueInput,
      criticalBlock: parsed.data.criticalBlock ?? existingRule.criticalBlock,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok) {
    const status = result.message.includes("Only admins") ? 403 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const rule = await getRuleApiRecordById(resolved.value.ruleId);

  if (!rule) {
    return buildApiErrorResponse("Rule was updated but could not be read back.", 500);
  }

  return buildMutationResponse(rule, {
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
