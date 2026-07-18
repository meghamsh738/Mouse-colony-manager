import { NextResponse } from "next/server";

import { actorHasCapability, type Capability } from "@/lib/capabilities";
import { recordSecurityEventBestEffort, securityEventTimeBucket } from "@/lib/security-event";
import { resolveCurrentActor, type ResolvedActor } from "@/lib/session";

type ApiMetaValue = string | number | boolean;

export type ApiRouteUser = ResolvedActor;

export async function requireApiUser(
  capability: Capability,
): Promise<{ user: ApiRouteUser } | { response: NextResponse }> {
  const actor = await resolveCurrentActor();

  if (!actor) {
    const dedupeKey = `api:unauthenticated:${capability}:${securityEventTimeBucket()}`;
    await recordSecurityEventBestEffort({
      eventType: "authorization.api.unauthenticated",
      outcome: "denied",
      severity: "warning",
      correlationId: dedupeKey,
      dedupeKey,
      subjectType: "capability",
      subjectId: capability,
      source: "api_guard",
      summary: "Unauthenticated API access was denied.",
    });
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  if (!actorHasCapability(actor, capability)) {
    const dedupeKey = `api:forbidden:${actor.id}:${capability}:${securityEventTimeBucket()}`;
    await recordSecurityEventBestEffort({
      eventType: "authorization.api.forbidden",
      outcome: "denied",
      severity: "warning",
      actorId: actor.id,
      scopeLabId: actor.activeLabId,
      correlationId: dedupeKey,
      dedupeKey,
      subjectType: "capability",
      subjectId: capability,
      source: "api_guard",
      summary: "Forbidden API access was denied.",
    });
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user: actor };
}

export function compactApiMeta(input: Record<string, ApiMetaValue | undefined>) {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, ApiMetaValue] => entry[1] !== undefined));
}

export function buildCollectionResponse<T>(
  data: T[],
  input: {
    total: number;
    limit?: number;
    filters?: Record<string, ApiMetaValue>;
  },
) {
  return NextResponse.json({
    data,
    meta: {
      count: data.length,
      total: input.total,
      limit: input.limit ?? data.length,
      filters: input.filters ?? {},
      generatedAt: new Date().toISOString(),
    },
  });
}

export function buildItemResponse<T>(data: T) {
  return NextResponse.json({
    data,
    meta: {
      generatedAt: new Date().toISOString(),
    },
  });
}

export function buildMutationResponse<T>(
  data: T,
  input: {
    status: number;
    message: string;
    created: boolean;
  },
) {
  return NextResponse.json(
    {
      data,
      meta: {
        created: input.created,
        message: input.message,
        generatedAt: new Date().toISOString(),
      },
    },
    { status: input.status },
  );
}

export function buildIndexResponse<T>(data: T) {
  return NextResponse.json({
    data,
    meta: {
      generatedAt: new Date().toISOString(),
    },
  });
}

export function buildNotFoundResponse(entityLabel: string, entityId: string) {
  return NextResponse.json({ error: `${entityLabel} not found`, entityId }, { status: 404 });
}

export function buildApiErrorResponse(error: string, status = 400, details?: unknown) {
  return NextResponse.json(
    {
      error,
      ...(details ? { details } : {}),
    },
    { status },
  );
}
