import { NextResponse } from "next/server";

import { auth } from "@/auth";
import type { UserRole } from "@/lib/types";

type ApiMetaValue = string | number | boolean;

export type ApiRouteUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  role: UserRole;
};

export async function requireApiUser(): Promise<{ user: ApiRouteUser } | { response: NextResponse }> {
  const session = await auth();

  if (!session?.user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
    },
  };
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
