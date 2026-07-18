import { actorHasCapability } from "@/lib/capabilities";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";

type SecurityHistoryInput = {
  cursor?: string | null;
  query?: string | null;
  severity?: "info" | "warning" | "critical" | null;
  outcome?: "succeeded" | "denied" | "failed" | null;
  limit?: number;
};

export type OutboxQueueStatus = "pending" | "leased" | "retry" | "delivered" | "dead_letter" | "cancelled";

type OutboxQueueInput = {
  cursor?: string | null;
  query?: string | null;
  status?: OutboxQueueStatus | null;
  limit?: number;
};

function requireTechnicalConsoleAccess(actor: ResolvedActor) {
  if (!actorHasCapability(actor, "system:view") || !actorHasCapability(actor, "audit:security")) {
    throw new Error("Technical security history is unavailable.");
  }
}

export async function getSecurityEventHistoryView(actor: ResolvedActor, input: SecurityHistoryInput = {}) {
  requireTechnicalConsoleAccess(actor);

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const query = input.query?.trim().slice(0, 160);
  const events = await prisma.securityEvent.findMany({
    where: {
      ...(input.severity ? { severity: input.severity } : {}),
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(query ? { OR: [
        { eventType: { contains: query, mode: "insensitive" } },
        { summary: { contains: query, mode: "insensitive" } },
        { source: { contains: query, mode: "insensitive" } },
        { correlationId: { contains: query, mode: "insensitive" } },
        { subjectId: { contains: query, mode: "insensitive" } },
        { actor: { name: { contains: query, mode: "insensitive" } } },
        { scopeLab: { code: { contains: query, mode: "insensitive" } } },
      ] } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      eventType: true,
      severity: true,
      outcome: true,
      actorRole: true,
      correlationId: true,
      subjectType: true,
      subjectId: true,
      source: true,
      summary: true,
      occurredAt: true,
      actor: { select: { name: true } },
      scopeLab: { select: { code: true } },
    },
  });
  const hasMore = events.length > limit;
  const items = events.slice(0, limit).map((event) => ({
    ...event,
    occurredAt: event.occurredAt.toISOString(),
  }));

  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}

export async function getOutboxQueueView(actor: ResolvedActor, input: OutboxQueueInput = {}) {
  requireTechnicalConsoleAccess(actor);

  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const query = input.query?.trim().slice(0, 160);
  const now = new Date();
  const messages = await prisma.outboxMessage.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      ...(query ? { OR: [
        { id: { contains: query, mode: "insensitive" } },
        { topic: { contains: query, mode: "insensitive" } },
      ] } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      topic: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      availableAt: true,
      leasedAt: true,
      leaseExpiresAt: true,
      deliveredAt: true,
      deadLetteredAt: true,
      createdAt: true,
      updatedAt: true,
      attempts: {
        orderBy: [{ attemptNumber: "desc" }, { id: "desc" }],
        take: 3,
        select: {
          id: true,
          attemptNumber: true,
          workerId: true,
          workerType: true,
          status: true,
          authorizedAt: true,
          startedAt: true,
          completedAt: true,
        },
      },
    },
  });
  const hasMore = messages.length > limit;
  const items = messages.slice(0, limit).map((message) => ({
    ...message,
    attemptsRemaining: Math.max(message.maxAttempts - message.attemptCount, 0),
    availability: message.status === "pending" || message.status === "retry"
      ? (message.availableAt <= now ? "ready" as const : "scheduled" as const)
      : "not_applicable" as const,
    leaseState: message.status === "leased"
      ? (!message.leaseExpiresAt ? "expiry_unknown" as const : message.leaseExpiresAt <= now ? "expired" as const : "active" as const)
      : "not_leased" as const,
    availableAt: message.availableAt.toISOString(),
    leasedAt: message.leasedAt?.toISOString() ?? null,
    leaseExpiresAt: message.leaseExpiresAt?.toISOString() ?? null,
    deliveredAt: message.deliveredAt?.toISOString() ?? null,
    deadLetteredAt: message.deadLetteredAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    attempts: message.attempts.map((attempt) => ({
      ...attempt,
      authorizedAt: attempt.authorizedAt.toISOString(),
      startedAt: attempt.startedAt.toISOString(),
      completedAt: attempt.completedAt?.toISOString() ?? null,
    })),
  }));

  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}

export async function getTechnicalConsoleView(actor: ResolvedActor, input: SecurityHistoryInput | number = {}) {
  requireTechnicalConsoleAccess(actor);
  const historyInput = typeof input === "number" ? { limit: input } : input;
  const [securityHistory, outboxStatusCounts, recentMigrations] = await Promise.all([
    getSecurityEventHistoryView(actor, historyInput),
    prisma.outboxMessage.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.migrationRun.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        migrationType: true,
        status: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    securityEvents: securityHistory.items,
    securityNextCursor: securityHistory.nextCursor,
    outboxStatuses: outboxStatusCounts.map((status) => ({
      status: status.status,
      count: status._count._all,
    })),
    recentMigrations: recentMigrations.map((migration) => ({
      ...migration,
      startedAt: migration.startedAt?.toISOString() ?? null,
      completedAt: migration.completedAt?.toISOString() ?? null,
      createdAt: migration.createdAt.toISOString(),
    })),
  };
}
