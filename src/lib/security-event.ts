import { randomUUID } from "node:crypto";

import type { Prisma, SecurityEventOutcome, SecurityEventSeverity } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type SecurityEventClient = Pick<Prisma.TransactionClient, "securityEvent">;

export type SecurityEventInput = {
  eventType: string;
  outcome: SecurityEventOutcome;
  severity?: SecurityEventSeverity;
  actorId?: string | null;
  scopeLabId?: string | null;
  correlationId?: string | null;
  dedupeKey?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  source: string;
  summary: string;
  occurredAt?: Date;
};

type BestEffortSecurityEventInput = SecurityEventInput & { dedupeKey: string };

const BEST_EFFORT_TIMEOUT_MS = 250;
const BEST_EFFORT_STATEMENT_TIMEOUT_MS = 200;
const BEST_EFFORT_TRANSACTION_TIMEOUT_MS = 1_000;
const BEST_EFFORT_CIRCUIT_MS = 30_000;
const SECURITY_EVENT_BUCKET_MS = 5 * 60_000;
const BEST_EFFORT_KEY_CACHE_MAX = 2_048;

let bestEffortCircuitOpenUntil = 0;
let bestEffortAttempt: Promise<unknown> | undefined;
const submittedBestEffortKeys = new Map<string, number>();

function cleanOptional(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function validateSecurityEvent(input: SecurityEventInput) {
  const subjectType = cleanOptional(input.subjectType);
  const subjectId = cleanOptional(input.subjectId);

  if ((subjectType === null) !== (subjectId === null)) {
    throw new Error("Security event subjects require both a type and identifier.");
  }
  if (!/^[a-z][a-z0-9_.-]{2,119}$/.test(input.eventType)) {
    throw new Error("Security event type is invalid.");
  }
  if (input.source.trim().length < 2 || input.source.trim().length > 120) {
    throw new Error("Security event source is invalid.");
  }
  if (input.summary.trim().length < 2 || input.summary.trim().length > 500) {
    throw new Error("Security event summary is invalid.");
  }
  if (input.dedupeKey !== undefined && input.dedupeKey !== null && !cleanOptional(input.dedupeKey)) {
    throw new Error("Security event dedupe key is invalid.");
  }

  return { subjectType, subjectId };
}

export async function writeSecurityEvent(client: SecurityEventClient, input: SecurityEventInput) {
  const subject = validateSecurityEvent(input);
  const dedupeKey = cleanOptional(input.dedupeKey);
  const data = {
    id: `security-${randomUUID()}`,
    eventType: input.eventType,
    outcome: input.outcome,
    severity: input.severity ?? "info",
    actorId: cleanOptional(input.actorId),
    scopeLabId: cleanOptional(input.scopeLabId),
    correlationId: cleanOptional(input.correlationId),
    dedupeKey,
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    source: input.source.trim(),
    summary: input.summary.trim(),
    occurredAt: input.occurredAt ?? new Date(),
  };

  if (!dedupeKey) return client.securityEvent.create({ data });
  await client.securityEvent.createMany({ data: [data], skipDuplicates: true });
  const existing = await client.securityEvent.findUniqueOrThrow({ where: { dedupeKey } });
  const semanticFields = [
    "eventType", "outcome", "severity", "actorId", "scopeLabId", "correlationId",
    "subjectType", "subjectId", "source", "summary",
  ] as const;
  if (semanticFields.some((field) => existing[field] !== data[field])) {
    throw new Error("Security event dedupe key collision has different semantics.");
  }
  return existing;
}

export async function recordSecurityEvent(input: SecurityEventInput) {
  return writeSecurityEvent(prisma, input);
}

export function securityEventTimeBucket(now = new Date()) {
  return Math.floor(now.getTime() / SECURITY_EVENT_BUCKET_MS).toString(36);
}

export async function recordSecurityEventBestEffort(input: BestEffortSecurityEventInput) {
  const now = Date.now();
  if (bestEffortAttempt || now < bestEffortCircuitOpenUntil) {
    return "circuit_open" as const;
  }
  const dedupeKey = input.dedupeKey.trim();
  if ((submittedBestEffortKeys.get(dedupeKey) ?? 0) > now) {
    return "deduplicated" as const;
  }
  submittedBestEffortKeys.set(dedupeKey, now + SECURITY_EVENT_BUCKET_MS);
  if (submittedBestEffortKeys.size > BEST_EFFORT_KEY_CACHE_MAX) {
    const oldest = submittedBestEffortKeys.keys().next().value;
    if (oldest) submittedBestEffortKeys.delete(oldest);
  }

  const attempt = prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${BEST_EFFORT_STATEMENT_TIMEOUT_MS}ms'`);
    return tx.securityEvent.createMany({
      data: [{
        id: `security-${randomUUID()}`,
        eventType: input.eventType,
        outcome: input.outcome,
        severity: input.severity ?? "info",
        actorId: cleanOptional(input.actorId),
        scopeLabId: cleanOptional(input.scopeLabId),
        correlationId: cleanOptional(input.correlationId),
        dedupeKey: cleanOptional(input.dedupeKey),
        ...validateSecurityEvent(input),
        source: input.source.trim(),
        summary: input.summary.trim(),
        occurredAt: input.occurredAt ?? new Date(),
      }],
      skipDuplicates: true,
    });
  }, {
    maxWait: BEST_EFFORT_STATEMENT_TIMEOUT_MS,
    timeout: BEST_EFFORT_TRANSACTION_TIMEOUT_MS,
  });
  bestEffortAttempt = attempt;
  void attempt.then(
    () => {
      if (bestEffortAttempt === attempt) bestEffortAttempt = undefined;
    },
    () => {
      if (bestEffortAttempt === attempt) bestEffortAttempt = undefined;
    },
  );

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      attempt,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Security event write timed out.")), BEST_EFFORT_TIMEOUT_MS);
      }),
    ]);
    return "recorded" as const;
  } catch (error) {
    bestEffortCircuitOpenUntil = Date.now() + BEST_EFFORT_CIRCUIT_MS;
    console.error("Unable to record security event", error);
    return "failed" as const;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function resetSecurityEventCircuitForTests() {
  bestEffortCircuitOpenUntil = 0;
  bestEffortAttempt = undefined;
  submittedBestEffortKeys.clear();
}
