import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import {
  Prisma,
  type AlertSeverity,
  type CommandReceipt,
  type FacilityIdentifierType,
  type NotificationDeliveryKind,
  type OutboxMessage,
  type WorkflowDraftStatus,
} from "@prisma/client";

import { getActorCapabilities, normalizeUserRole, type Capability } from "@/lib/capabilities";
import { getActiveFacilityDutiesAtDatabaseTime } from "@/lib/facility-duty-auth";
import { prisma } from "@/lib/prisma";
import { writeSecurityEvent } from "@/lib/security-event";
import type { ResolvedActor } from "@/lib/session";

export const OUTBOX_TOPIC_AUTHORITY = {
  "notifications.in_app": "notifications:deliver",
  "notifications.email": "notifications:deliver",
  "notifications.digest": "notifications:deliver",
  "billing.invoice": "billing:generate",
  "sop.assignment": "sops:manage",
  "audit.security": "audit:security",
  "workflow.command": "approvals:read",
} as const satisfies Record<string, Capability>;

export type OutboxTopic = keyof typeof OUTBOX_TOPIC_AUTHORITY;

export const OUTBOX_MAX_ATTEMPTS = 12;
export const OUTBOX_MAX_CLAIM_BATCH = 100;
export const OUTBOX_MAX_MAINTENANCE_BATCH = 100;

export const OUTBOX_WORKER_TOPICS = {
  // Dashboard notifications are materialized transactionally and no producer
  // enqueues notifications.in_app, so the email worker must not claim it.
  notification_delivery: ["notifications.email", "notifications.digest"],
  billing_delivery: ["billing.invoice"],
  sop_delivery: ["sop.assignment"],
  security_audit: ["audit.security"],
  workflow_dispatch: ["workflow.command"],
} as const satisfies Record<string, readonly OutboxTopic[]>;

const OUTBOX_WORKER_TOKEN_ENV = {
  notification_delivery: "OUTBOX_WORKER_TOKEN_NOTIFICATION_DELIVERY",
  billing_delivery: "OUTBOX_WORKER_TOKEN_BILLING_DELIVERY",
  sop_delivery: "OUTBOX_WORKER_TOKEN_SOP_DELIVERY",
  security_audit: "OUTBOX_WORKER_TOKEN_SECURITY_AUDIT",
  workflow_dispatch: "OUTBOX_WORKER_TOKEN_WORKFLOW_DISPATCH",
} as const satisfies Record<keyof typeof OUTBOX_WORKER_TOPICS, string>;

export type OutboxWorkerType = keyof typeof OUTBOX_WORKER_TOPICS;
const authenticatedWorker = Symbol("authenticated-outbox-worker");
export type AuthenticatedOutboxWorker = {
  id: string;
  type: OutboxWorkerType;
  [authenticatedWorker]: true;
};

export function authenticateOutboxWorker(input: {
  workerId: string;
  workerType: OutboxWorkerType;
  token: string;
}): AuthenticatedOutboxWorker | null {
  const workerId = input.workerId.trim();
  const expected = process.env[OUTBOX_WORKER_TOKEN_ENV[input.workerType]];
  if (!workerId || !expected || expected.length < 32) return null;
  const providedToken = Buffer.from(input.token);
  const expectedToken = Buffer.from(expected);
  if (providedToken.length !== expectedToken.length) return null;
  const valid = timingSafeEqual(providedToken, expectedToken);
  return valid ? { id: workerId, type: input.workerType, [authenticatedWorker]: true } : null;
}

function assertAuthenticatedWorker(worker: AuthenticatedOutboxWorker) {
  if (!worker || worker[authenticatedWorker] !== true || !OUTBOX_WORKER_TOPICS[worker.type]) {
    throw new Error("Authenticated outbox worker authority is required.");
  }
}

export type StaleConflict = {
  ok: false;
  code: "stale_conflict";
  aggregateType: string;
  aggregateId: string;
  expectedVersion: number;
  currentVersion: number | null;
  message: string;
};

export class FacilityIdentifierExhaustedError extends Error {
  readonly code = "facility_identifier_exhausted";

  constructor(readonly entityType: FacilityIdentifierType) {
    super(`No ${entityType} facility IDs remain in the configured four-digit range.`);
    this.name = "FacilityIdentifierExhaustedError";
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function canonicalJsonHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(sortJson(value))).digest("hex");
}

export async function allocateFacilityIdentifiers(
  tx: Prisma.TransactionClient,
  entityType: FacilityIdentifierType,
  count: number,
) {
  if (!Number.isInteger(count) || count < 1) throw new Error("Identifier allocation count must be a positive integer.");
  const rows = await tx.$queryRaw<Array<{
    sequence_value: bigint | number;
    width: bigint | number;
  }>>(Prisma.sql`
    WITH sequence_row AS (
      SELECT "nextValue", "maximumValue", width
      FROM "FacilityIdentitySequence"
      WHERE "entityType" = ${entityType}::"FacilityIdentifierType"
      FOR UPDATE
    ), candidates AS (
      SELECT value AS sequence_value, sequence_row.width
      FROM sequence_row
      CROSS JOIN LATERAL generate_series(sequence_row."nextValue", sequence_row."maximumValue") value
      WHERE NOT EXISTS (
        SELECT 1 FROM "LegacyIdentifierAlias" alias
        WHERE alias."entityType" = ${entityType}::"FacilityIdentifierType"
          AND alias.alias = LPAD(value::text, sequence_row.width, '0')
      )
      ORDER BY value
      LIMIT ${count}
    ), allocation AS (
      SELECT COUNT(*) AS allocated_count, MAX(sequence_value) AS last_value FROM candidates
    ), advance AS (
      UPDATE "FacilityIdentitySequence" sequence
      SET "nextValue" = allocation.last_value + 1, "updatedAt" = CURRENT_TIMESTAMP
      FROM allocation
      WHERE sequence."entityType" = ${entityType}::"FacilityIdentifierType"
        AND allocation.allocated_count = ${count}
      RETURNING sequence.width
    )
    SELECT candidates.sequence_value, candidates.width
    FROM candidates, advance
    ORDER BY candidates.sequence_value
  `);
  if (rows.length !== count) throw new FacilityIdentifierExhaustedError(entityType);
  return rows.map((allocation) => String(Number(allocation.sequence_value)).padStart(Number(allocation.width), "0"));
}

export async function reauthorizeActorForCommand(
  tx: Prisma.TransactionClient,
  actor: Pick<ResolvedActor, "id" | "authzVersion" | "activeLabId">,
  requiredCapability?: Capability,
  labId?: string | null,
) {
  const user = await tx.user.findUnique({
    where: { id: actor.id },
    select: {
      active: true,
      authzVersion: true,
      role: true,
      labMemberships: {
        where: { active: true, lab: { active: true } },
        select: {
          labId: true,
          role: true,
          lab: { select: { name: true, code: true } },
        },
      },
    },
  });
  if (!user?.active || user.authzVersion !== actor.authzVersion) return false;

  const canonicalRole = normalizeUserRole(user.role);
  const activeDuties = canonicalRole === "it_head"
    ? []
    : await getActiveFacilityDutiesAtDatabaseTime(tx, actor.id);
  const requestedLabId = labId ?? actor.activeLabId;
  const membership = canonicalRole === "lab_user"
    ? user.labMemberships.find((candidate) => candidate.labId === requestedLabId)
    : undefined;
  if (canonicalRole === "lab_user" && requestedLabId && !membership) return false;

  const capabilities = getActorCapabilities({
    canonicalRole,
    activeMembership: membership
      ? {
          labId: membership.labId,
          labName: membership.lab.name,
          labCode: membership.lab.code,
          role: membership.role,
        }
      : null,
    activeDuties,
  });
  return !requiredCapability || capabilities.has(requiredCapability);
}

export async function createWorkflowDraft(input: {
  actor: ResolvedActor;
  workflowType: string;
  labId?: string | null;
  payload: Prisma.InputJsonValue;
  expiresAt?: Date | null;
}) {
  return prisma.$transaction(async (tx) => {
    if (!await reauthorizeActorForCommand(tx, input.actor, undefined, input.labId)) {
      return { ok: false as const, code: "forbidden", message: "Your current access no longer permits this workflow." };
    }
    const draft = await tx.workflowDraft.create({
      data: {
        id: randomUUID(),
        workflowType: input.workflowType,
        actorId: input.actor.id,
        labId: input.labId ?? null,
        payload: input.payload,
        expiresAt: input.expiresAt ?? null,
      },
    });
    return { ok: true as const, draft };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function upsertWorkflowDraft(input: {
  actor: ResolvedActor;
  draftId: string;
  workflowType: string;
  requiredCapability: Capability;
  labId?: string | null;
  expectedVersion: number;
  payload: Prisma.InputJsonValue;
  expiresAt?: Date | null;
}) {
  return prisma.$transaction(async (tx) => {
    const labId = input.labId ?? (input.actor.canonicalRole === "lab_user" ? input.actor.activeLabId : null);
    if (!await reauthorizeActorForCommand(tx, input.actor, input.requiredCapability, labId)) {
      return { ok: false as const, code: "forbidden", message: "Your current access no longer permits this workflow." };
    }
    const existing = await tx.workflowDraft.findUnique({ where: { id: input.draftId } });
    if (!existing) {
      if (input.expectedVersion !== 0) {
        return staleConflict("workflow_draft", input.draftId, input.expectedVersion, null);
      }
      const draft = await tx.workflowDraft.create({
        data: {
          id: input.draftId,
          workflowType: input.workflowType,
          actorId: input.actor.id,
          labId,
          payload: input.payload,
          expiresAt: input.expiresAt ?? null,
        },
      });
      return { ok: true as const, draft, created: true as const };
    }
    if (
      existing.actorId !== input.actor.id
      || existing.workflowType !== input.workflowType
      || existing.labId !== labId
    ) {
      return { ok: false as const, code: "not_found", message: "Workflow draft not found." };
    }
    if (existing.expiresAt && existing.expiresAt <= new Date()) {
      return { ok: false as const, code: "expired", message: "This workflow draft has expired." };
    }
    if (!["draft", "review"].includes(existing.status)) {
      return { ok: false as const, code: "invalid_state", message: "This workflow can no longer be edited." };
    }
    const updated = await tx.workflowDraft.updateMany({
      where: { id: existing.id, version: input.expectedVersion },
      data: {
        payload: input.payload,
        status: "draft",
        version: { increment: 1 },
        expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      },
    });
    if (!updated.count) return staleConflict("workflow_draft", existing.id, input.expectedVersion, existing.version);
    return {
      ok: true as const,
      draft: await tx.workflowDraft.findUniqueOrThrow({ where: { id: existing.id } }),
      created: false as const,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getWorkflowDraftForActor(input: {
  actor: ResolvedActor;
  draftId: string;
  workflowTypePrefix: string;
  requiredCapability: Capability;
}) {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.workflowDraft.findUnique({ where: { id: input.draftId } });
    if (
      !draft
      || draft.actorId !== input.actor.id
      || !draft.workflowType.startsWith(input.workflowTypePrefix)
      || !["draft", "review"].includes(draft.status)
      || (draft.expiresAt && draft.expiresAt <= new Date())
      || !await reauthorizeActorForCommand(tx, input.actor, input.requiredCapability, draft.labId)
    ) {
      return { ok: false as const, code: "not_found", message: "Workflow draft not found." };
    }
    return { ok: true as const, draft };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function saveWorkflowDraft(input: {
  actor: ResolvedActor;
  draftId: string;
  expectedVersion: number;
  payload: Prisma.InputJsonValue;
}) {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.workflowDraft.findUnique({ where: { id: input.draftId } });
    if (!draft || draft.actorId !== input.actor.id) {
      return { ok: false as const, code: "not_found", message: "Workflow draft not found." };
    }
    if (!await reauthorizeActorForCommand(tx, input.actor, undefined, draft.labId)) {
      return { ok: false as const, code: "forbidden", message: "Your current access no longer permits this workflow." };
    }
    if (draft.expiresAt && draft.expiresAt <= new Date()) {
      return { ok: false as const, code: "expired", message: "This workflow draft has expired." };
    }
    if (!["draft", "review"].includes(draft.status)) {
      return { ok: false as const, code: "invalid_state", message: "This workflow can no longer be edited." };
    }
    const updated = await tx.workflowDraft.updateMany({
      where: { id: draft.id, version: input.expectedVersion },
      data: { payload: input.payload, status: "draft", version: { increment: 1 } },
    });
    if (!updated.count) return staleConflict("workflow_draft", draft.id, input.expectedVersion, draft.version);
    return {
      ok: true as const,
      draft: await tx.workflowDraft.findUniqueOrThrow({ where: { id: draft.id } }),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function createWorkflowReviewSnapshot(input: {
  actor: ResolvedActor;
  draftId: string;
  expectedVersion: number;
}) {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.workflowDraft.findUnique({ where: { id: input.draftId } });
    if (!draft || draft.actorId !== input.actor.id) {
      return { ok: false as const, code: "not_found", message: "Workflow draft not found." };
    }
    if (!await reauthorizeActorForCommand(tx, input.actor, undefined, draft.labId)) {
      return { ok: false as const, code: "forbidden", message: "Your current access no longer permits this workflow." };
    }
    if (draft.expiresAt && draft.expiresAt <= new Date()) {
      return { ok: false as const, code: "expired", message: "This workflow draft has expired." };
    }
    if (!["draft", "review"].includes(draft.status)) {
      return { ok: false as const, code: "invalid_state", message: "This workflow can no longer be reviewed." };
    }
    if (draft.version !== input.expectedVersion) {
      return staleConflict("workflow_draft", draft.id, input.expectedVersion, draft.version);
    }
    const snapshot = await tx.workflowReviewSnapshot.create({
      data: {
        id: randomUUID(),
        draftId: draft.id,
        draftVersion: draft.version,
        payload: draft.payload as Prisma.InputJsonValue,
        payloadHash: canonicalJsonHash(draft.payload),
        createdById: input.actor.id,
      },
    });
    await tx.workflowDraft.update({
      where: { id: draft.id },
      data: { status: "review", version: { increment: 1 } },
    });
    return { ok: true as const, snapshot };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function prepareWorkflowReview(input: {
  actor: ResolvedActor;
  draftId: string;
  workflowType: string;
  requiredCapability: Capability;
  labId?: string | null;
  payload: Prisma.InputJsonValue;
  allowCommittedReplay?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const labId = input.labId ?? (input.actor.canonicalRole === "lab_user" ? input.actor.activeLabId : null);
    if (!await reauthorizeActorForCommand(tx, input.actor, input.requiredCapability, labId)) {
      return { ok: false as const, code: "forbidden", message: "Your current access no longer permits this workflow." };
    }

    let draft = await tx.workflowDraft.findUnique({ where: { id: input.draftId } });
    if (!draft) {
      draft = await tx.workflowDraft.create({
        data: {
          id: input.draftId,
          workflowType: input.workflowType,
          actorId: input.actor.id,
          labId,
          payload: input.payload,
        },
      });
    } else if (
      draft.actorId !== input.actor.id
      || draft.workflowType !== input.workflowType
      || draft.labId !== labId
    ) {
      return { ok: false as const, code: "not_found", message: "Workflow draft not found." };
    }

    const payloadHash = canonicalJsonHash(input.payload);
    if (draft.status === "committed" && input.allowCommittedReplay) {
      const snapshot = await tx.workflowReviewSnapshot.findFirst({
        where: { draftId: draft.id, createdById: input.actor.id, payloadHash },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (
        snapshot
        && canonicalJsonHash(snapshot.payload) === snapshot.payloadHash
        && canonicalJsonHash(draft.payload) === payloadHash
      ) {
        return { ok: true as const, draft, snapshot, replayed: true as const };
      }
      return { ok: false as const, code: "invalid_state", message: "This committed workflow does not match the submitted review." };
    }
    if (draft.expiresAt && draft.expiresAt <= new Date()) {
      return { ok: false as const, code: "expired", message: "This workflow draft has expired." };
    }
    if (!["draft", "review"].includes(draft.status)) {
      return { ok: false as const, code: "invalid_state", message: "This workflow can no longer be submitted." };
    }

    if (draft.status === "review") {
      const existingSnapshot = await tx.workflowReviewSnapshot.findUnique({
        where: { draftId_draftVersion: { draftId: draft.id, draftVersion: draft.version - 1 } },
      });
      if (existingSnapshot?.payloadHash === payloadHash) {
        return { ok: true as const, draft, snapshot: existingSnapshot, replayed: true as const };
      }
    }

    if (canonicalJsonHash(draft.payload) !== payloadHash || draft.status === "review") {
      const updated = await tx.workflowDraft.updateMany({
        where: { id: draft.id, version: draft.version },
        data: { payload: input.payload, status: "draft", version: { increment: 1 } },
      });
      if (!updated.count) {
        const current = await tx.workflowDraft.findUnique({ where: { id: draft.id }, select: { version: true } });
        return staleConflict("workflow_draft", draft.id, draft.version, current?.version ?? null);
      }
      draft = await tx.workflowDraft.findUniqueOrThrow({ where: { id: draft.id } });
    }

    const snapshot = await tx.workflowReviewSnapshot.create({
      data: {
        id: randomUUID(),
        draftId: draft.id,
        draftVersion: draft.version,
        payload: draft.payload as Prisma.InputJsonValue,
        payloadHash,
        createdById: input.actor.id,
      },
    });
    draft = await tx.workflowDraft.update({
      where: { id: draft.id },
      data: { status: "review", version: { increment: 1 } },
    });
    return { ok: true as const, draft, snapshot, replayed: false as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export function staleConflict(
  aggregateType: string,
  aggregateId: string,
  expectedVersion: number,
  currentVersion: number | null,
): StaleConflict {
  return {
    ok: false,
    code: "stale_conflict",
    aggregateType,
    aggregateId,
    expectedVersion,
    currentVersion,
    message: "This record changed after you opened it. Refresh and review the latest version before trying again.",
  };
}

const VERSIONED_AGGREGATE_TABLES = {
  animal: true,
  cage: true,
  intake_batch: true,
  breeding_setup: true,
  litter: true,
  experiment: true,
  invoice: true,
  cage_charge_category: true,
  quarantine_case: true,
  lab_transfer_request: true,
  sop_document: true,
  sop_assignment: true,
  procedure_plan: true,
  cryostorage_request: true,
  strain_directory_listing: true,
  strain_directory_request: true,
  notification_recipient: true,
  notification_preference: true,
  workflow_draft: true,
} as const;

export type VersionedAggregateType = keyof typeof VERSIONED_AGGREGATE_TABLES;

export async function getAggregateVersion(
  tx: Prisma.TransactionClient,
  aggregateType: VersionedAggregateType,
  aggregateId: string,
  scope: { labId: string | null; actorId: string },
) {
  const lab = scope.labId;
  switch (aggregateType) {
    case "animal":
      return (await tx.animal.findFirst({
        where: { id: aggregateId, ...(lab ? { owningLabId: lab } : {}) },
        select: { version: true },
      }))?.version ?? null;
    case "cage":
      return (await tx.cage.findFirst({
        where: { id: aggregateId, ...(lab ? { labId: lab } : {}) },
        select: { version: true },
      }))?.version ?? null;
    case "intake_batch":
      return (await tx.animalIntakeBatch.findFirst({
        where: { id: aggregateId, ...(lab ? { labId: lab } : {}) },
        select: { version: true },
      }))?.version ?? null;
    case "breeding_setup":
      return (await tx.breedingSetup.findFirst({
        where: { id: aggregateId, ...(lab ? { labId: lab } : {}) },
        select: { version: true },
      }))?.version ?? null;
    case "litter":
      return (await tx.litter.findFirst({
        where: { id: aggregateId, ...(lab ? { breedingSetup: { labId: lab } } : {}) },
        select: { version: true },
      }))?.version ?? null;
    case "experiment":
      return (await tx.experiment.findFirst({
        where: { id: aggregateId, ...(lab ? { labId: lab } : {}) },
        select: { version: true },
      }))?.version ?? null;
    case "invoice":
      return (await tx.invoice.findFirst({
        where: { id: aggregateId, ...(lab ? { labId: lab } : {}) },
        select: { version: true },
      }))?.version ?? null;
    case "cage_charge_category":
      return (await tx.cageChargeCategory.findFirst({
        where: { id: aggregateId },
        select: { version: true },
      }))?.version ?? null;
    case "quarantine_case":
      return (await tx.quarantineCase.findFirst({
        where: { id: aggregateId, ...(lab ? { labId: lab } : {}) },
        select: { version: true },
      }))?.version ?? null;
    case "lab_transfer_request":
      return (await tx.labTransferRequest.findFirst({
        where: {
          id: aggregateId,
          ...(lab ? { OR: [{ sourceLabId: lab }, { destinationLabId: lab }] } : {}),
        },
        select: { version: true },
      }))?.version ?? null;
    case "sop_document":
      return (await tx.$queryRaw<Array<{ version: number }>>(Prisma.sql`
        SELECT version
        FROM "SopDocument"
        WHERE id = ${aggregateId}
          AND (
            (${lab}::text IS NOT NULL AND scope = 'lab'::"SopScope" AND "labId" = ${lab})
            OR (${lab}::text IS NULL AND scope = 'facility'::"SopScope" AND "labId" IS NULL)
          )
        LIMIT 1
      `))[0]?.version ?? null;
    case "sop_assignment":
      return (await tx.sopAssignment.findFirst({
        where: { id: aggregateId, ...(lab ? { labId: lab } : {}) },
        select: { version: true },
      }))?.version ?? null;
    case "procedure_plan":
      return (await tx.procedurePlan.findFirst({
        where: { id: aggregateId, ...(lab ? { labId: lab } : {}) },
        select: { version: true },
      }))?.version ?? null;
    case "cryostorage_request":
      return (await tx.cryostorageRequest.findFirst({
        where: { id: aggregateId, ...(lab ? { labId: lab } : {}) },
        select: { version: true },
      }))?.version ?? null;
    case "strain_directory_listing":
      return (await tx.strainDirectoryListing.findFirst({
        where: { id: aggregateId, ...(lab ? { labId: lab } : {}) },
        select: { version: true },
      }))?.version ?? null;
    case "strain_directory_request":
      return (await tx.strainDirectoryRequest.findFirst({
        where: {
          id: aggregateId,
          ...(lab ? { OR: [{ requesterLabId: lab }, { listing: { labId: lab } }] } : {}),
        },
        select: { version: true },
      }))?.version ?? null;
    case "notification_recipient":
      return (await tx.notificationRecipient.findFirst({
        where: {
          id: aggregateId,
          userId: scope.actorId,
          ...(lab ? { labId: lab } : {}),
        },
        select: { version: true },
      }))?.version ?? null;
    case "notification_preference":
      return (await tx.notificationPreference.findFirst({
        where: { id: aggregateId, userId: scope.actorId },
        select: { version: true },
      }))?.version ?? null;
    case "workflow_draft":
      return (await tx.workflowDraft.findFirst({
        where: { id: aggregateId, actorId: scope.actorId, ...(lab ? { labId: lab } : {}) },
        select: { version: true },
      }))?.version ?? null;
  }
}

type CommandHandlerSuccess<T extends Prisma.InputJsonValue> = {
  ok: true;
  result: T;
  aggregateType?: string;
  aggregateId?: string;
  resultingVersion?: number;
};

type CommandHandlerFailure = {
  ok: false;
  code: string;
  message: string;
  result?: Prisma.InputJsonValue;
};

export type CommandHandlerContext = {
  receiptId: string;
};

function isRetryableTransactionError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("40001")
    || message.includes("could not serialize access")
    || message.includes("SET TRANSACTION ISOLATION LEVEL must be called before any query")
    || message.includes("unexpected message from server")
    || message.includes("Server has closed the connection");
}

export async function executeIdempotentCommand<T extends Prisma.InputJsonValue>(input: {
  actor: ResolvedActor;
  commandType: string;
  idempotencyKey: string;
  requestId: string;
  request: Prisma.InputJsonValue;
  requiredCapability: Capability;
  labId?: string | null;
  workflowDraftId?: string | null;
  aggregateType?: string;
  aggregateId?: string;
  expectedVersion?: number;
  handler: (
    tx: Prisma.TransactionClient,
    context: CommandHandlerContext,
  ) => Promise<CommandHandlerSuccess<T> | CommandHandlerFailure>;
}) {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) return { ok: false as const, code: "invalid_idempotency_key", message: "An idempotency key is required." };
  const aggregateId = input.aggregateId?.trim() || null;
  if (input.expectedVersion !== undefined && (
    !input.aggregateType
    || !(input.aggregateType in VERSIONED_AGGREGATE_TABLES)
    || !aggregateId
  )) {
    return {
      ok: false as const,
      code: "invalid_aggregate_type",
      message: "Expected-version commands require a supported aggregate type and aggregate ID.",
    };
  }
  const commandLabId = input.labId ?? (input.actor.canonicalRole === "lab_user" ? input.actor.activeLabId : null);
  const requestHash = canonicalJsonHash({
    commandType: input.commandType,
    labId: commandLabId,
    workflowDraftId: input.workflowDraftId ?? null,
    aggregateType: input.aggregateType ?? null,
    aggregateId,
    expectedVersion: input.expectedVersion ?? null,
    requiredCapability: input.requiredCapability,
    request: input.request,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
      const receiptId = randomUUID();
      const inserted = await tx.$queryRaw<CommandReceipt[]>(Prisma.sql`
        INSERT INTO "CommandReceipt" (
          id, "actorId", "labId", "workflowDraftId", "commandType", "idempotencyKey",
          "requestHash", "requestId", status, "aggregateType", "aggregateId", "expectedVersion", "startedAt"
        ) VALUES (
          ${receiptId}, ${input.actor.id}, ${commandLabId}, ${input.workflowDraftId ?? null},
          ${input.commandType}, ${idempotencyKey}, ${requestHash}, ${input.requestId},
          'processing'::"CommandReceiptStatus", ${input.aggregateType ?? null}, ${aggregateId},
          ${input.expectedVersion ?? null}, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("actorId", "commandType", "idempotencyKey") DO NOTHING
        RETURNING *
      `);
      const receipt = inserted[0] ?? await tx.commandReceipt.findUniqueOrThrow({
        where: {
          actorId_commandType_idempotencyKey: {
            actorId: input.actor.id,
            commandType: input.commandType,
            idempotencyKey,
          },
        },
      });
      const authorized = await reauthorizeActorForCommand(tx, input.actor, input.requiredCapability, commandLabId);
      if (!authorized) {
        const message = "Your current authorization no longer permits this command.";
        if (inserted.length) {
          await tx.commandReceipt.update({
            where: { id: receipt.id },
            data: { status: "failed", errorCode: "forbidden", errorMessage: message, completedAt: new Date() },
          });
        }
        return { ok: false as const, code: "forbidden", message, receiptId: receipt.id };
      }
      if (!inserted.length) {
        if (receipt.requestHash !== requestHash) {
          return { ok: false as const, code: "idempotency_conflict", message: "This idempotency key was already used for a different request." };
        }
        if (receipt.status === "processing") {
          return { ok: false as const, code: "command_in_progress", message: "The original command is still processing.", receiptId: receipt.id };
        }
        return {
          ok: receipt.status === "succeeded",
          code: receipt.errorCode ?? undefined,
          message: receipt.errorMessage ?? undefined,
          result: receipt.result,
          receiptId: receipt.id,
          replayed: true as const,
        };
      }

      if (input.aggregateType && aggregateId && input.expectedVersion !== undefined
        && input.aggregateType in VERSIONED_AGGREGATE_TABLES) {
        const currentVersion = await getAggregateVersion(
          tx,
          input.aggregateType as VersionedAggregateType,
          aggregateId,
          { labId: commandLabId, actorId: input.actor.id },
        );
        if (currentVersion === null) {
          const message = "The requested record was not found.";
          await tx.commandReceipt.update({
            where: { id: receipt.id },
            data: { status: "failed", errorCode: "not_found", errorMessage: message, completedAt: new Date() },
          });
          return { ok: false as const, code: "not_found", message, receiptId: receipt.id };
        }
        if (currentVersion !== input.expectedVersion) {
          const conflict = staleConflict(input.aggregateType, aggregateId, input.expectedVersion, currentVersion);
          await tx.commandReceipt.update({
            where: { id: receipt.id },
            data: {
              status: "failed",
              errorCode: conflict.code,
              errorMessage: conflict.message,
              result: conflict as unknown as Prisma.InputJsonValue,
              completedAt: new Date(),
            },
          });
          return { ...conflict, receiptId: receipt.id };
        }
      }

      await tx.$queryRaw(Prisma.sql`
        SELECT
          set_config('mcm.audit_receipt_id', ${receipt.id}, true),
          set_config('mcm.audit_actor_id', ${input.actor.id}, true),
          set_config('mcm.audit_command_type', ${input.commandType}, true),
          set_config('mcm.audit_request_hash', ${requestHash}, true)
      `);
      const handled = await input.handler(tx, { receiptId: receipt.id });
      if (!handled.ok) {
        await tx.commandReceipt.update({
          where: { id: receipt.id },
          data: {
            status: "failed",
            errorCode: handled.code,
            errorMessage: handled.message,
            result: handled.result,
            completedAt: new Date(),
          },
        });
        return { ...handled, receiptId: receipt.id };
      }
      await tx.commandReceipt.update({
        where: { id: receipt.id },
        data: {
          status: "succeeded",
          result: handled.result,
          aggregateType: handled.aggregateType ?? input.aggregateType,
          aggregateId: handled.aggregateId ?? input.aggregateId,
          resultingVersion: handled.resultingVersion,
          completedAt: new Date(),
        },
      });
      return { ok: true as const, result: handled.result, receiptId: receipt.id, replayed: false as const };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
    } catch (error) {
      if (attempt < 2 && isRetryableTransactionError(error)) continue;
      console.error("[command-foundation] command failed", {
        commandType: input.commandType,
        actorId: input.actor.id,
        requestId: input.requestId,
      }, error);
      return {
        ok: false as const,
        code: "unexpected_error",
        message: "The command could not be completed. Retry with the same idempotency key.",
      };
    }
  }
  return { ok: false as const, code: "unexpected_error", message: "The command could not be completed." };
}

export async function enqueueOutboxMessage(tx: Prisma.TransactionClient, input: {
  topic: OutboxTopic;
  aggregateType: string;
  aggregateId: string;
  actor: Pick<ResolvedActor, "id" | "authzVersion">;
  labId?: string | null;
  payload: Prisma.InputJsonValue;
  dedupeKey?: string | null;
  availableAt?: Date;
  maxAttempts?: number;
}) {
  return tx.outboxMessage.create({
    data: {
      id: randomUUID(),
      topic: input.topic,
      dedupeKey: input.dedupeKey ?? null,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      actorId: input.actor.id,
      actorAuthzVersion: input.actor.authzVersion,
      labId: input.labId ?? null,
      requiredCapability: OUTBOX_TOPIC_AUTHORITY[input.topic],
      payload: input.payload,
      availableAt: input.availableAt ?? new Date(),
      maxAttempts: Math.max(1, Math.min(input.maxAttempts ?? 8, OUTBOX_MAX_ATTEMPTS)),
    },
  });
}

function outboxPayloadRecord(payload: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, Prisma.JsonValue>
    : null;
}

async function isCurrentOutboxAggregate(tx: Prisma.TransactionClient, message: OutboxMessage) {
  if (message.topic.startsWith("notifications.")) {
    const payload = outboxPayloadRecord(message.payload);
    if (!payload || message.aggregateType !== "notification_delivery" || payload.deliveryId !== message.aggregateId) return false;
    const delivery = await tx.notificationDelivery.findUnique({
      where: { id: message.aggregateId },
      include: {
        recipient: {
          include: {
            audience: true,
            event: true,
            user: {
              select: {
                active: true,
                authzVersion: true,
                role: true,
                email: true,
                labMemberships: {
                  where: { active: true, lab: { active: true } },
                  select: { labId: true, role: true },
                },
              },
            },
          },
        },
      },
    });
    if (!delivery || delivery.status !== "queued" || delivery.outboxMessageId !== message.id) return false;
    const recipient = delivery.recipient;
    const event = recipient.event;
    const audience = recipient.audience;
    const user = recipient.user;
    if (
      recipient.status !== "active"
      || recipient.resolvedAt
      || event.status === "resolved"
      || recipient.recipientAuthzVersion !== user.authzVersion
      || recipient.recipientRole !== user.role
      || !user.active
      || !user.email.trim()
      || recipient.labId !== event.labId
      || message.labId !== recipient.labId
      || payload.recipientId !== recipient.id
      || payload.recipientVersion !== delivery.recipientVersion
      || payload.preferenceVersion !== delivery.preferenceVersion
      || payload.eventId !== event.id
      || payload.eventVersion !== delivery.eventVersion
      || (delivery.providerRequestBody === null && delivery.eventVersion !== event.version)
      || (delivery.kind === "immediate" && (!event.urgent || message.topic !== "notifications.email"))
      || (delivery.kind === "digest" && (event.urgent || message.topic !== "notifications.digest"))
    ) return false;

    if (delivery.kind === "digest") {
      const preference = await tx.notificationPreference.findUnique({
        where: { userId_categoryKey: { userId: recipient.userId, categoryKey: event.categoryKey } },
        select: { emailMode: true, version: true },
      });
      if (!preference || preference.emailMode === "off" || preference.version !== delivery.preferenceVersion) return false;
    }

    if (audience.audienceType === "user") {
      if (audience.userId !== recipient.userId) return false;
      if (!event.labId) return recipient.recipientMembershipRole === null;
    }
    if (audience.audienceType === "facility_role") {
      return recipient.recipientMembershipRole === null
        && audience.facilityRole !== null
        && normalizeUserRole(user.role) === audience.facilityRole;
    }
    const membership = user.labMemberships.find((candidate) => candidate.labId === event.labId);
    return Boolean(
      membership
      && membership.role === recipient.recipientMembershipRole
      && (audience.audienceType !== "lab_members" || audience.labId === event.labId),
    );
  }
  if (message.topic !== "sop.assignment") return true;
  const payload = outboxPayloadRecord(message.payload);
  if (!payload || message.aggregateType !== "sop_assignment" || payload.assignmentId !== message.aggregateId) return false;
  const assignment = await tx.sopAssignment.findUnique({
    where: { id: message.aggregateId },
    select: {
      sopId: true,
      sopVersionId: true,
      labId: true,
      revokedAt: true,
      sopVersion: { select: { contentHash: true } },
    },
  });
  return Boolean(
    assignment
    && !assignment.revokedAt
    && assignment.sopId === payload.sopId
    && assignment.sopVersionId === payload.sopVersionId
    && assignment.labId === message.labId
    && assignment.labId === payload.labId
    && assignment.sopVersion.contentHash === payload.contentHash,
  );
}

function isInstitutionalOutboxTopic(topic: OutboxTopic) {
  return topic === "sop.assignment" || topic.startsWith("notifications.");
}

async function updateNotificationDeliveryForCancellation(
  tx: Prisma.TransactionClient,
  message: OutboxMessage,
  now: Date,
  reason: string,
) {
  if (!message.topic.startsWith("notifications.")) return;
  await tx.notificationDelivery.updateMany({
    where: { outboxMessageId: message.id, status: "queued" },
    data: {
      status: "cancelled",
      cancelledAt: now,
      lastError: reason,
      version: { increment: 1 },
    },
  });
}

export type OutboxLeaseMaintenanceResult = {
  scanned: number;
  retried: number;
  deadLettered: number;
};

export async function maintainExpiredOutboxLeases(input: {
  worker: AuthenticatedOutboxWorker;
  limit?: number;
}): Promise<OutboxLeaseMaintenanceResult> {
  assertAuthenticatedWorker(input.worker);
  const topics = [...OUTBOX_WORKER_TOPICS[input.worker.type]];
  const limit = Math.max(1, Math.min(input.limit ?? 25, OUTBOX_MAX_MAINTENANCE_BATCH));
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const expired = await tx.$queryRaw<OutboxMessage[]>(Prisma.sql`
      SELECT * FROM "OutboxMessage"
      WHERE topic IN (${Prisma.join(topics)})
        AND status = 'leased'
        AND "leaseExpiresAt" <= CURRENT_TIMESTAMP
      ORDER BY "leaseExpiresAt", "createdAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);
    let retried = 0;
    let deadLettered = 0;
    for (const message of expired) {
      const effectiveMaxAttempts = Math.max(1, Math.min(message.maxAttempts, OUTBOX_MAX_ATTEMPTS));
      const deadLetter = message.attemptCount >= effectiveMaxAttempts;
      const reason = deadLetter
        ? "Final delivery lease expired before completion."
        : "Delivery lease expired before completion and is ready for retry.";
      await tx.outboxMessage.update({
        where: { id: message.id },
        data: {
          status: deadLetter ? "dead_letter" : "retry",
          availableAt: deadLetter ? message.availableAt : now,
          deadLetteredAt: deadLetter ? now : null,
          leaseOwner: null,
          leaseToken: null,
          workerType: null,
          leasedAt: null,
          leaseExpiresAt: null,
          authorizedAt: null,
          authorizedCapability: null,
          authorizedActorAuthzVersion: null,
          lastError: reason,
        },
      });
      await tx.outboxDeliveryAttempt.updateMany({
        where: { messageId: message.id, attemptNumber: message.attemptCount, status: "processing" },
        data: { status: "failed", completedAt: now, errorMessage: "Delivery lease expired." },
      });
      await tx.notificationDelivery.updateMany({
        where: { outboxMessageId: message.id, status: "queued" },
        data: {
          status: deadLetter ? "failed" : "queued",
          failedAt: deadLetter ? now : null,
          attemptCount: message.attemptCount,
          lastError: reason,
          version: { increment: 1 },
        },
      });
      if (deadLetter) {
        deadLettered += 1;
        await writeSecurityEvent(tx, {
          eventType: "technical.outbox.dead_lettered",
          outcome: "failed",
          severity: "critical",
          actorId: message.actorId,
          scopeLabId: message.labId,
          correlationId: message.id,
          dedupeKey: `technical.outbox.dead_lettered:lease:${message.id}`,
          subjectType: "outbox_message",
          subjectId: message.id,
          source: "outbox_worker",
          summary: "Background delivery exhausted its lease attempts.",
          occurredAt: now,
        });
      } else {
        retried += 1;
      }
    }
    return { scanned: expired.length, retried, deadLettered };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function claimOutboxMessages(input: {
  worker: AuthenticatedOutboxWorker;
  limit?: number;
  leaseMs?: number;
  maintainExpiredLeases?: boolean;
  maintenanceLimit?: number;
  claimBefore?: Date;
  excludeMessageIds?: readonly string[];
}) {
  assertAuthenticatedWorker(input.worker);
  const topics = [...OUTBOX_WORKER_TOPICS[input.worker.type]];
  const limit = Math.max(1, Math.min(input.limit ?? 25, OUTBOX_MAX_CLAIM_BATCH));
  const scanLimit = Math.min(Math.max(limit * 4, 10), OUTBOX_MAX_CLAIM_BATCH);
  const excludedMessageIds = [...new Set(input.excludeMessageIds ?? [])].slice(0, OUTBOX_MAX_CLAIM_BATCH);
  const exclusion = excludedMessageIds.length
    ? Prisma.sql`AND id NOT IN (${Prisma.join(excludedMessageIds)})`
    : Prisma.empty;
  const leaseMs = Math.max(5_000, Math.min(input.leaseMs ?? 60_000, 15 * 60_000));
  if (input.maintainExpiredLeases !== false) {
    await maintainExpiredOutboxLeases({
      worker: input.worker,
      limit: input.maintenanceLimit,
    });
  }
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    if (input.claimBefore && now >= input.claimBefore) return [];
    const candidates = await tx.$queryRaw<OutboxMessage[]>(Prisma.sql`
      SELECT * FROM "OutboxMessage"
      WHERE topic IN (${Prisma.join(topics)})
        AND "availableAt" <= CURRENT_TIMESTAMP
        AND "attemptCount" < LEAST(GREATEST("maxAttempts", 1), ${OUTBOX_MAX_ATTEMPTS})
        AND status IN ('pending', 'retry')
        ${exclusion}
      ORDER BY "availableAt", "createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT ${scanLimit}
    `);
    const leased: OutboxMessage[] = [];
    for (const message of candidates) {
      if (leased.length >= limit) break;
      const topic = message.topic as OutboxTopic;
      const requiredCapability = OUTBOX_TOPIC_AUTHORITY[topic];
      const aggregateValid = await isCurrentOutboxAggregate(tx, message);
      if (!aggregateValid) {
        const cancellationReason = "The referenced aggregate is no longer active or no longer matches the committed payload.";
        await tx.outboxMessage.update({
          where: { id: message.id },
          data: {
            status: "cancelled",
            leaseOwner: null,
            leaseToken: null,
            workerType: null,
            leasedAt: null,
            leaseExpiresAt: null,
            lastError: cancellationReason,
          },
        });
        await updateNotificationDeliveryForCancellation(tx, message, now, cancellationReason);
        continue;
      }
      // A valid assignment is institutional authority after commit; the author
      // may leave while the exact-version obligation remains active.
      const authorized = isInstitutionalOutboxTopic(topic)
        ? Boolean(requiredCapability && message.requiredCapability === requiredCapability && message.actorId)
        : Boolean(requiredCapability
        && message.requiredCapability === requiredCapability
        && message.actorId
        && message.actorAuthzVersion !== null
        && await reauthorizeActorForCommand(
          tx,
          { id: message.actorId, authzVersion: message.actorAuthzVersion, activeLabId: message.labId },
          requiredCapability,
          message.labId,
        ));
      if (!authorized) {
        await tx.outboxMessage.update({
          where: { id: message.id },
          data: {
            status: "dead_letter",
            deadLetteredAt: now,
            leaseOwner: null,
            leaseToken: null,
            workerType: null,
            leasedAt: null,
            leaseExpiresAt: null,
            lastError: "Delegated actor authorization is no longer valid.",
          },
        });
        await writeSecurityEvent(tx, {
          eventType: "technical.outbox.authorization_denied",
          outcome: "denied",
          severity: "critical",
          actorId: message.actorId,
          scopeLabId: message.labId,
          correlationId: message.id,
          dedupeKey: `technical.outbox.authorization_denied:${message.id}`,
          subjectType: "outbox_message",
          subjectId: message.id,
          source: "outbox_worker",
          summary: "Delegated background authorization was denied.",
          occurredAt: now,
        });
        continue;
      }
      if (input.claimBefore && new Date() >= input.claimBefore) break;

      const leaseToken = randomUUID();
      const attemptNumber = message.attemptCount + 1;
      const updated = await tx.outboxMessage.update({
        where: { id: message.id },
        data: {
          status: "leased",
          leaseOwner: input.worker.id,
          leaseToken,
          workerType: input.worker.type,
          leasedAt: now,
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
          authorizedAt: now,
          authorizedCapability: requiredCapability,
          authorizedActorAuthzVersion: message.actorAuthzVersion,
          attemptCount: attemptNumber,
        },
      });
      await tx.notificationDelivery.updateMany({
        where: { outboxMessageId: message.id, status: "queued" },
        data: { attemptCount: attemptNumber, version: { increment: 1 } },
      });
      await tx.outboxDeliveryAttempt.create({
        data: {
          id: randomUUID(),
          messageId: message.id,
          attemptNumber,
          workerId: input.worker.id,
          workerType: input.worker.type,
          leaseToken,
          authorizedAt: now,
          authorizedCapability: requiredCapability,
        },
      });
      leased.push(updated);
    }
    return leased;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reauthorizeOutboxMessage(message: OutboxMessage) {
  const expectedCapability = OUTBOX_TOPIC_AUTHORITY[message.topic as OutboxTopic];
  if (!expectedCapability || message.requiredCapability !== expectedCapability || !message.actorId || message.actorAuthzVersion === null) {
    return false;
  }
  if (isInstitutionalOutboxTopic(message.topic as OutboxTopic)) {
    return prisma.$transaction((tx) => isCurrentOutboxAggregate(tx, message));
  }
  return prisma.$transaction((tx) => reauthorizeActorForCommand(
    tx,
    { id: message.actorId!, authzVersion: message.actorAuthzVersion!, activeLabId: message.labId },
    expectedCapability,
    message.labId,
  ));
}

export type ClaimedNotificationProviderPayload = {
  message: OutboxMessage;
  deliveryId: string;
  userId: string;
  email: string;
  recipientName: string;
  kind: NotificationDeliveryKind;
  categoryKey: string;
  severity: AlertSeverity;
  messageText: string;
  actionLabel: string;
  deepLink: string;
  occurredAt: Date;
};

export type ClaimedNotificationProviderRequest = {
  deliveryId: string;
  userId: string;
  recipientEmail: string;
  eventVersion: number;
  providerAdapter: string;
  providerEndpoint: string;
  providerAccount: string;
  idempotencyKey: string;
  body: string;
  bodyHash: string;
};

export type NotificationProviderIdentity = {
  adapter: string;
  endpoint: string;
  account: string;
};

type NotificationProviderReceipt = {
  providerMessageId?: string | null;
  providerStatus?: number | null;
};

export async function deliverClaimedNotificationMessage(input: {
  messageId: string;
  worker: AuthenticatedOutboxWorker;
  leaseToken: string;
  provider: NotificationProviderIdentity;
  prepare: (payload: ClaimedNotificationProviderPayload) => { body: string };
  send: (request: ClaimedNotificationProviderRequest) => Promise<NotificationProviderReceipt>;
}) {
  assertAuthenticatedWorker(input.worker);
  const prepared = await prisma.$transaction(async (tx) => {
    const initial = await tx.notificationDelivery.findUnique({
      where: { outboxMessageId: input.messageId },
      select: {
        id: true,
        recipientId: true,
        recipient: {
          select: {
            userId: true,
            labId: true,
            event: { select: { id: true, entityType: true, entityId: true } },
          },
        },
      },
    });
    if (!initial) return { status: "cancelled" as const };

    if (initial.recipient.event.entityType === "animal") {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM "Animal" WHERE id = ${initial.recipient.event.entityId} FOR SHARE
      `);
    } else if (initial.recipient.event.entityType === "cage") {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM "Cage" WHERE id = ${initial.recipient.event.entityId} FOR SHARE
      `);
    }
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "NotificationEvent" WHERE id = ${initial.recipient.event.id} FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "NotificationRecipient" WHERE id = ${initial.recipientId} FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "NotificationDelivery" WHERE id = ${initial.id} FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "User" WHERE id = ${initial.recipient.userId} FOR SHARE
    `);
    if (initial.recipient.labId) {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM "LabMembership"
        WHERE "userId" = ${initial.recipient.userId} AND "labId" = ${initial.recipient.labId}
        FOR SHARE
      `);
    }
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "OutboxDeliveryAttempt" WHERE "leaseToken" = ${input.leaseToken} FOR UPDATE
    `);
    const now = new Date();
    const message = await tx.outboxMessage.findFirst({
      where: {
        id: input.messageId,
        status: "leased",
        leaseOwner: input.worker.id,
        workerType: input.worker.type,
        leaseToken: input.leaseToken,
        leaseExpiresAt: { gt: now },
      },
    });
    if (!message) return { status: "cancelled" as const };

    const topic = message.topic as OutboxTopic;
    const expectedCapability = OUTBOX_TOPIC_AUTHORITY[topic];
    const workerTopics = OUTBOX_WORKER_TOPICS[input.worker.type] as readonly OutboxTopic[];
    const evidenceValid = message.topic.startsWith("notifications.")
      && workerTopics.includes(topic)
      && expectedCapability === "notifications:deliver"
      && message.requiredCapability === expectedCapability
      && message.authorizedCapability === expectedCapability
      && message.authorizedActorAuthzVersion === message.actorAuthzVersion
      && Boolean(message.authorizedAt && message.actorId && message.actorAuthzVersion !== null);
    const aggregateValid = evidenceValid && await isCurrentOutboxAggregate(tx, message);
    if (!aggregateValid) {
      const reason = "The notification recipient, audience, or owning lab changed before provider delivery.";
      await tx.outboxMessage.update({
        where: { id: message.id },
        data: {
          status: "cancelled",
          leaseOwner: null,
          leaseToken: null,
          workerType: null,
          leasedAt: null,
          leaseExpiresAt: null,
          lastError: reason,
        },
      });
      await tx.outboxDeliveryAttempt.update({
        where: { leaseToken: input.leaseToken },
        data: { status: "failed", completedAt: now, errorMessage: reason },
      });
      await updateNotificationDeliveryForCancellation(tx, message, now, reason);
      return { status: "cancelled" as const };
    }

    const delivery = await tx.notificationDelivery.findUnique({
      where: { id: initial.id },
      include: {
        recipient: {
          include: {
            event: true,
            user: { select: { id: true, email: true, name: true } },
          },
        },
      },
    });
    if (!delivery || delivery.status !== "queued") return { status: "cancelled" as const };
    if (!delivery.eventVersion) throw new Error("Notification delivery is missing its event-version snapshot.");

    let body = delivery.providerRequestBody;
    let bodyHash = delivery.providerRequestHash;
    let idempotencyKey = delivery.providerIdempotencyKey;
    let recipientEmail = delivery.providerRequestTo;
    let providerAdapter = delivery.providerAdapter;
    let providerEndpoint = delivery.providerEndpoint;
    let providerAccount = delivery.providerAccount;
    if (body && (
      providerAdapter !== input.provider.adapter
      || providerEndpoint !== input.provider.endpoint
      || providerAccount !== input.provider.account
    )) {
      const reason = "Notification provider adapter, endpoint, or account changed after request preparation; operator reconciliation is required.";
      await tx.outboxMessage.update({
        where: { id: message.id },
        data: {
          status: "dead_letter",
          deadLetteredAt: now,
          leaseOwner: null,
          leaseToken: null,
          workerType: null,
          leasedAt: null,
          leaseExpiresAt: null,
          authorizedAt: null,
          authorizedCapability: null,
          authorizedActorAuthzVersion: null,
          lastError: reason,
        },
      });
      await tx.outboxDeliveryAttempt.update({
        where: { leaseToken: input.leaseToken },
        data: { status: "failed", completedAt: now, errorMessage: reason },
      });
      await tx.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "failed",
          failedAt: now,
          lastError: reason,
          version: { increment: 1 },
        },
      });
      await writeSecurityEvent(tx, {
        eventType: "technical.outbox.dead_lettered",
        outcome: "failed",
        severity: "critical",
        actorId: message.actorId,
        scopeLabId: message.labId,
        correlationId: message.id,
        dedupeKey: `technical.outbox.dead_lettered:provider_identity:${message.id}`,
        subjectType: "outbox_message",
        subjectId: message.id,
        source: "notification_delivery",
        summary: "Notification delivery requires reconciliation after its provider identity changed.",
        occurredAt: now,
      });
      return { status: "reconciliation_required" as const };
    }
    if (!body) {
      const payload: ClaimedNotificationProviderPayload = {
        message,
        deliveryId: delivery.id,
        userId: delivery.recipient.user.id,
        email: delivery.recipient.user.email,
        recipientName: delivery.recipient.user.name,
        kind: delivery.kind,
        categoryKey: delivery.recipient.event.categoryKey,
        severity: delivery.recipient.event.severity,
        messageText: delivery.recipient.event.message,
        actionLabel: delivery.recipient.event.actionLabel,
        deepLink: delivery.recipient.event.deepLink,
        occurredAt: delivery.recipient.event.occurredAt,
      };
      body = input.prepare(payload).body;
      if (body.length < 2 || body.length > 1_000_000) throw new Error("Notification provider request body is invalid.");
      bodyHash = createHash("sha256").update(body).digest("hex");
      idempotencyKey = delivery.id;
      recipientEmail = payload.email;
      providerAdapter = input.provider.adapter;
      providerEndpoint = input.provider.endpoint;
      providerAccount = input.provider.account;
      await tx.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          providerRequestBody: body,
          providerRequestHash: bodyHash,
          providerIdempotencyKey: idempotencyKey,
          providerRequestTo: recipientEmail,
          providerAdapter,
          providerEndpoint,
          providerAccount,
          providerRequestPreparedAt: new Date(),
          version: { increment: 1 },
        },
      });
    }
    if (!bodyHash || !idempotencyKey || !recipientEmail || !providerAdapter || !providerEndpoint || !providerAccount) {
      throw new Error("Notification provider request snapshot is incomplete.");
    }
    if (idempotencyKey !== delivery.id || createHash("sha256").update(body).digest("hex") !== bodyHash) {
      throw new Error("Notification provider request snapshot failed its integrity check.");
    }
    return {
      status: "prepared" as const,
      request: {
        deliveryId: delivery.id,
        userId: delivery.recipient.user.id,
        recipientEmail,
        eventVersion: delivery.eventVersion,
        providerAdapter,
        providerEndpoint,
        providerAccount,
        idempotencyKey,
        body,
        bodyHash,
      },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 10_000 });

  if (prepared.status !== "prepared") return prepared;
  const receipt = await input.send(prepared.request);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "OutboxMessage" WHERE id = ${input.messageId} FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "NotificationDelivery" WHERE id = ${prepared.request.deliveryId} FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "OutboxDeliveryAttempt" WHERE "leaseToken" = ${input.leaseToken} FOR UPDATE
    `);
    const now = new Date();
    const message = await tx.outboxMessage.findFirst({
      where: {
        id: input.messageId,
        status: "leased",
        leaseOwner: input.worker.id,
        workerType: input.worker.type,
        leaseToken: input.leaseToken,
        leaseExpiresAt: { gt: now },
      },
    });
    if (!message) throw new Error("Notification delivery lease changed before provider receipt finalization.");
    const delivery = await tx.notificationDelivery.findFirst({
      where: {
        id: prepared.request.deliveryId,
        outboxMessageId: message.id,
        status: "queued",
        eventVersion: prepared.request.eventVersion,
        providerIdempotencyKey: prepared.request.idempotencyKey,
        providerRequestHash: prepared.request.bodyHash,
        providerRequestBody: prepared.request.body,
        providerRequestTo: prepared.request.recipientEmail,
        providerAdapter: prepared.request.providerAdapter,
        providerEndpoint: prepared.request.providerEndpoint,
        providerAccount: prepared.request.providerAccount,
      },
    });
    if (!delivery) throw new Error("Notification provider request snapshot changed before finalization.");
    if (createHash("sha256").update(prepared.request.body).digest("hex") !== prepared.request.bodyHash) {
      throw new Error("Notification provider request body changed before finalization.");
    }
    const authorizationStillCurrent = await isCurrentOutboxAggregate(tx, message);
    const completedAt = new Date();
    await tx.outboxMessage.update({
      where: { id: message.id },
      data: {
        status: "delivered",
        deliveredAt: completedAt,
        leaseOwner: null,
        leaseToken: null,
        workerType: null,
        leasedAt: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
    await tx.outboxDeliveryAttempt.update({
      where: { leaseToken: input.leaseToken },
      data: { status: "delivered", completedAt },
    });
    await tx.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "delivered",
        deliveredAt: completedAt,
        deliveredTo: prepared.request.recipientEmail,
        providerMessageId: receipt.providerMessageId?.trim() || null,
        providerStatus: receipt.providerStatus ?? null,
        lastError: null,
        version: { increment: 1 },
      },
    });
    if (!authorizationStillCurrent) {
      await writeSecurityEvent(tx, {
        eventType: "technical.notification.authorization_changed_during_delivery",
        outcome: "failed",
        severity: "critical",
        actorId: message.actorId,
        scopeLabId: message.labId,
        correlationId: message.id,
        dedupeKey: `technical.notification.authorization_changed_during_delivery:${message.id}`,
        subjectType: "outbox_message",
        subjectId: message.id,
        source: "notification_delivery",
        summary: "Notification authority changed after the immutable provider request was sent.",
        occurredAt: completedAt,
      });
    }
    return { status: "delivered" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 10_000 });
}

export async function completeOutboxMessage(input: {
  messageId: string;
  worker: AuthenticatedOutboxWorker;
  leaseToken: string;
  deliveredTo?: string;
  providerMessageId?: string | null;
  providerStatus?: number | null;
}) {
  assertAuthenticatedWorker(input.worker);
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const message = await tx.outboxMessage.findFirst({
      where: {
        id: input.messageId,
        status: "leased",
        leaseOwner: input.worker.id,
        workerType: input.worker.type,
        leaseToken: input.leaseToken,
        leaseExpiresAt: { gt: now },
      },
    });
    if (!message) return false;
    const topic = message.topic as OutboxTopic;
    const expectedCapability = OUTBOX_TOPIC_AUTHORITY[topic];
    const workerTopics = OUTBOX_WORKER_TOPICS[input.worker.type] as readonly OutboxTopic[];
    const evidenceValid = workerTopics.includes(topic)
      && expectedCapability
      && message.requiredCapability === expectedCapability
      && message.authorizedCapability === expectedCapability
      && message.authorizedActorAuthzVersion === message.actorAuthzVersion
      && message.authorizedAt
      && message.actorId
      && message.actorAuthzVersion !== null;
    const aggregateValid = evidenceValid && await isCurrentOutboxAggregate(tx, message);
    const actorValid = isInstitutionalOutboxTopic(topic)
      ? aggregateValid
      : aggregateValid && await reauthorizeActorForCommand(
        tx,
        { id: message.actorId!, authzVersion: message.actorAuthzVersion!, activeLabId: message.labId },
        expectedCapability,
        message.labId,
      );
    if (!actorValid) {
      const staleInstitutionalAggregate = isInstitutionalOutboxTopic(topic) && !aggregateValid;
      const staleReason = topic === "sop.assignment"
        ? "The SOP assignment was revoked, superseded, or changed before delivery completed."
        : "The notification recipient or audience was revoked before delivery completed.";
      await tx.outboxMessage.update({
        where: { id: message.id },
        data: {
          status: staleInstitutionalAggregate ? "cancelled" : "dead_letter",
          deadLetteredAt: staleInstitutionalAggregate ? null : now,
          leaseOwner: null,
          leaseToken: null,
          workerType: null,
          leasedAt: null,
          leaseExpiresAt: null,
          lastError: staleInstitutionalAggregate
            ? staleReason
            : "Delegated authorization was revoked before completion.",
        },
      });
      await tx.outboxDeliveryAttempt.update({
        where: { leaseToken: input.leaseToken },
        data: {
          status: "failed",
          completedAt: now,
          errorMessage: staleInstitutionalAggregate
            ? staleReason
            : "Delegated authorization was revoked.",
        },
      });
      if (staleInstitutionalAggregate) {
        await updateNotificationDeliveryForCancellation(tx, message, now, staleReason);
      } else {
        await writeSecurityEvent(tx, {
          eventType: "technical.outbox.authorization_revoked",
          outcome: "denied",
          severity: "critical",
          actorId: message.actorId,
          scopeLabId: message.labId,
          correlationId: message.id,
          dedupeKey: `technical.outbox.authorization_revoked:${message.id}`,
          subjectType: "outbox_message",
          subjectId: message.id,
          source: "outbox_worker",
          summary: "Delegated background authorization was revoked.",
          occurredAt: now,
        });
      }
      return false;
    }
    if (message.topic.startsWith("notifications.")) {
      const deliveryTarget = await tx.notificationDelivery.findUnique({
        where: { outboxMessageId: message.id },
        select: { recipient: { select: { user: { select: { email: true } } } } },
      });
      if (!input.deliveredTo?.trim() || input.deliveredTo.trim() !== deliveryTarget?.recipient.user.email) {
        return false;
      }
    }
    await tx.outboxMessage.update({
      where: { id: message.id },
      data: {
        status: "delivered",
        deliveredAt: now,
        leaseOwner: null,
        leaseToken: null,
        workerType: null,
        leasedAt: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
    await tx.outboxDeliveryAttempt.update({
      where: { leaseToken: input.leaseToken },
      data: { status: "delivered", completedAt: now },
    });
    if (message.topic.startsWith("notifications.")) {
      const deliveredTo = input.deliveredTo?.trim();
      if (!deliveredTo) throw new Error("A delivered notification requires its recipient email address.");
      await tx.notificationDelivery.updateMany({
        where: { outboxMessageId: message.id, status: "queued" },
        data: {
          status: "delivered",
          deliveredAt: now,
          deliveredTo,
          providerMessageId: input.providerMessageId?.trim() || null,
          providerStatus: input.providerStatus ?? null,
          lastError: null,
          version: { increment: 1 },
        },
      });
    }
    return true;
  });
}

export async function failOutboxMessage(input: {
  messageId: string;
  worker: AuthenticatedOutboxWorker;
  leaseToken: string;
  errorMessage: string;
  retryAt?: Date;
}) {
  assertAuthenticatedWorker(input.worker);
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const message = await tx.outboxMessage.findFirst({
      where: {
        id: input.messageId,
        status: "leased",
        leaseOwner: input.worker.id,
        workerType: input.worker.type,
        leaseToken: input.leaseToken,
        leaseExpiresAt: { gt: now },
      },
    });
    if (!message) return false;
    const deadLetter = message.attemptCount >= Math.max(1, Math.min(message.maxAttempts, OUTBOX_MAX_ATTEMPTS));
    await tx.outboxMessage.update({
      where: { id: message.id },
      data: {
        status: deadLetter ? "dead_letter" : "retry",
        availableAt: deadLetter ? message.availableAt : input.retryAt ?? new Date(now.getTime() + 60_000),
        deadLetteredAt: deadLetter ? now : null,
        leaseOwner: null,
        leaseToken: null,
        workerType: null,
        leasedAt: null,
        leaseExpiresAt: null,
        authorizedAt: null,
        authorizedCapability: null,
        authorizedActorAuthzVersion: null,
        lastError: input.errorMessage,
      },
    });
    await tx.outboxDeliveryAttempt.update({
      where: { leaseToken: input.leaseToken },
      data: { status: "failed", completedAt: now, errorMessage: input.errorMessage },
    });
    await tx.notificationDelivery.updateMany({
      where: { outboxMessageId: message.id, status: "queued" },
      data: {
        status: deadLetter ? "failed" : "queued",
        failedAt: deadLetter ? now : null,
        attemptCount: message.attemptCount,
        lastError: input.errorMessage,
        version: { increment: 1 },
      },
    });
    if (deadLetter) {
      await writeSecurityEvent(tx, {
        eventType: "technical.outbox.dead_lettered",
        outcome: "failed",
        severity: "critical",
        actorId: message.actorId,
        scopeLabId: message.labId,
        correlationId: message.id,
        dedupeKey: `technical.outbox.dead_lettered:retry:${message.id}`,
        subjectType: "outbox_message",
        subjectId: message.id,
        source: "outbox_worker",
        summary: "Background delivery exhausted its retry attempts.",
        occurredAt: now,
      });
    }
    return true;
  });
}

export async function createMigrationRun(input: {
  actor: ResolvedActor;
  runKey: string;
  migrationType: string;
}) {
  return prisma.$transaction(async (tx) => {
    if (!await reauthorizeActorForCommand(tx, input.actor, "migrations:manage")) {
      return { ok: false as const, code: "forbidden", message: "Only current facility administrators can start migration runs." };
    }
    const run = await tx.migrationRun.create({
      data: {
        id: randomUUID(),
        runKey: input.runKey,
        migrationType: input.migrationType,
        status: "running",
        initiatedById: input.actor.id,
        startedAt: new Date(),
      },
    });
    return { ok: true as const, run };
  });
}

export async function recordOwnershipException(input: {
  actor: ResolvedActor;
  migrationRunId: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  currentValue?: Prisma.InputJsonValue;
  candidates?: Prisma.InputJsonValue;
  reason: string;
}) {
  return prisma.$transaction(async (tx) => {
    if (!await reauthorizeActorForCommand(tx, input.actor, "migrations:manage")) {
      return { ok: false as const, code: "forbidden", message: "Only current facility administrators can record ownership exceptions." };
    }
    const run = await tx.migrationRun.findFirst({
      where: { id: input.migrationRunId, status: "running" },
      select: { id: true },
    });
    if (!run) return { ok: false as const, code: "not_found", message: "Running migration not found." };
    const reason = input.reason.trim();
    if (!reason) return { ok: false as const, code: "invalid_reason", message: "An ownership exception reason is required." };
    const exception = await tx.ownershipException.create({
      data: {
        id: randomUUID(),
        migrationRunId: run.id,
        entityType: input.entityType,
        entityId: input.entityId,
        fieldName: input.fieldName,
        currentValue: input.currentValue,
        candidates: input.candidates,
        reason,
      },
    });
    return { ok: true as const, exception };
  });
}

export async function resolveOwnershipException(input: {
  actor: ResolvedActor;
  exceptionId: string;
  resolution: Prisma.InputJsonValue;
  status?: "resolved" | "rejected";
}) {
  return prisma.$transaction(async (tx) => {
    if (!await reauthorizeActorForCommand(tx, input.actor, "migrations:manage")) {
      return { ok: false as const, code: "forbidden", message: "Only current facility administrators can resolve ownership exceptions." };
    }
    const updated = await tx.ownershipException.updateMany({
      where: { id: input.exceptionId, status: "open" },
      data: {
        status: input.status ?? "resolved",
        resolution: input.resolution,
        resolvedById: input.actor.id,
        resolvedAt: new Date(),
      },
    });
    if (!updated.count) return { ok: false as const, code: "not_found", message: "Open ownership exception not found." };
    return { ok: true as const };
  });
}

export function isEditableDraftStatus(status: WorkflowDraftStatus) {
  return status === "draft" || status === "review";
}
