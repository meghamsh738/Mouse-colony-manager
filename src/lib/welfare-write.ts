import { createHash, randomUUID } from "node:crypto";

import {
  Prisma,
  type AlertSeverity,
  type FacilityDuty,
  type WelfareAdministrationOutcome,
  type WelfareCaseEventType,
  type WelfareCaseStatus,
} from "@prisma/client";

import { executeIdempotentCommand, reauthorizeActorForCommand, staleConflict } from "@/lib/command-foundation";
import { isElevatedIdentityContextCurrent } from "@/lib/identity-assurance";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";
import {
  canTransitionWelfareCase,
  canTransitionWelfareEscalation,
  canTransitionWelfareOrder,
  isAdministrableOrder,
  isTerminalWelfareCase,
  WELFARE_CANCELLATION_CODES,
  WELFARE_POLICY_MARKER,
} from "@/lib/welfare-state-machine";

type WelfareActor = ResolvedActor;
type CommandIdentity = { idempotencyKey: string; requestId: string };
type CaseCommandIdentity = CommandIdentity & { caseId: string; expectedVersion: number };

const operationalCodes = new Set(["routine_review", "condition_change", "post_procedure", "environmental_concern", "other"]);
const escalationCodes = new Set(["urgent_review", "condition_worsened", "treatment_concern", "humane_endpoint_review", "other"]);

function text(value: string, label: string, min = 2, max = 1000) {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new Error(`${label} must contain ${min}-${max} characters.`);
  return normalized;
}

function commandRequest(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function facilityScopedWelfareActor(actor: WelfareActor): WelfareActor {
  return { ...actor, activeLabId: null, activeMembership: null };
}

async function currentClinicalEvidence(
  tx: Prisma.TransactionClient,
  actor: WelfareActor,
  allowedDuties: readonly FacilityDuty[],
) {
  if (!actor.identityLinkId || !actor.authenticatedAt || !await isElevatedIdentityContextCurrent(tx, {
    userId: actor.id,
    identity: actor.email,
    identityLinkId: actor.identityLinkId,
    authenticationMethod: actor.authMethod,
    assurance: actor.assurance,
    authenticatedAt: actor.authenticatedAt,
  })) return null;

  const rows = await tx.$queryRaw<Array<{ id: string; version: number; duty: FacilityDuty }>>(Prisma.sql`
    SELECT assignment.id, assignment.version, assignment.duty
    FROM "FacilityDutyAssignment" assignment
    JOIN "User" actor ON actor.id = assignment."userId"
    WHERE assignment."userId" = ${actor.id}
      AND assignment.duty = ANY(${allowedDuties}::"FacilityDuty"[])
      AND assignment."revokedAt" IS NULL
      AND assignment."validFrom" <= CURRENT_TIMESTAMP
      AND assignment."validUntil" > CURRENT_TIMESTAMP
      AND actor.active
      AND actor."authzVersion" = ${actor.authzVersion}
      AND actor.role <> 'it_head'::"UserRole"
    ORDER BY CASE assignment.duty WHEN 'designated_veterinarian' THEN 0 ELSE 1 END, assignment.id
    LIMIT 1
  `);
  const assignment = rows[0];
  if (!assignment) return null;
  const authenticatedAt = new Date(actor.authenticatedAt);
  return Number.isNaN(authenticatedAt.getTime()) ? null : {
    assignment,
    assurance: actor.assurance!,
    identityLinkId: actor.identityLinkId,
    authenticatedAt,
  };
}

async function appendEvent(tx: Prisma.TransactionClient, input: {
  actor: WelfareActor;
  evidence: NonNullable<Awaited<ReturnType<typeof currentClinicalEvidence>>>;
  receiptId: string;
  caseId: string;
  labId: string;
  eventType: WelfareCaseEventType;
  fromStatus: WelfareCaseStatus | null;
  toStatus: WelfareCaseStatus;
  detail?: Prisma.InputJsonValue;
}) {
  const receipt = await tx.commandReceipt.findUniqueOrThrow({
    where: { id: input.receiptId },
    select: { requestId: true, commandType: true, aggregateType: true, aggregateId: true, labId: true },
  });
  await tx.welfareCaseLifecycleEvent.create({
    data: {
      id: `welfare-event-${randomUUID()}`,
      caseId: input.caseId,
      labId: input.labId,
      eventType: input.eventType,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorId: input.actor.id,
      actorAuthzVersion: input.actor.authzVersion,
      assurance: input.evidence.assurance,
      dutyAssignmentId: input.evidence.assignment.id,
      dutyAssignmentVersion: input.evidence.assignment.version,
      identityLinkId: input.evidence.identityLinkId,
      authenticatedAt: input.evidence.authenticatedAt,
      commandReceiptId: input.receiptId,
      detail: input.detail,
    },
  });
  await tx.auditLog.create({
    data: {
      id: `audit-welfare-${randomUUID()}`,
      actorId: input.actor.id,
      actorRole: input.actor.canonicalRole,
      labId: receipt.labId,
      requestId: receipt.requestId,
      commandReceiptId: input.receiptId,
      commandType: receipt.commandType,
      commandAggregateType: receipt.aggregateType,
      commandAggregateId: receipt.aggregateId,
      entityType: "WelfareCase",
      entityId: input.caseId,
      action: input.eventType,
      previousValue: input.fromStatus ? { status: input.fromStatus } : Prisma.JsonNull,
      newValue: { status: input.toStatus, policyMarker: WELFARE_POLICY_MARKER },
      timestamp: new Date(),
    },
  });
}

async function loadCase(tx: Prisma.TransactionClient, caseId: string) {
  return tx.welfareCase.findUnique({
    where: { id: caseId },
    include: { escalations: true, treatmentOrders: true, observations: { select: { id: true } }, administrationAttempts: { select: { id: true } } },
  });
}

function invalidTransition(from: WelfareCaseStatus, to: WelfareCaseStatus) {
  return { ok: false as const, code: "invalid_state", message: `The welfare case cannot move from ${from} to ${to}.` };
}

export async function executeOpenWelfareCaseCommand(input: {
  actor: WelfareActor;
  command: {
    subjectType: "animal" | "cage";
    subjectId: string;
    severity: AlertSeverity;
    operationalSummary: string;
    privateClinicalSummary: string;
    openedAt: Date;
    reopenedFromCaseId?: string | null;
    expectedSubjectVersion: number;
  };
} & CommandIdentity) {
  if (!await reauthorizeActorForCommand(prisma, facilityScopedWelfareActor(input.actor), "welfare:manage", null)) {
    return { ok: false as const, code: "forbidden", message: "Your current authorization no longer permits this command." };
  }
  const subjectSnapshot = input.command.subjectType === "animal"
    ? await prisma.animal.findUnique({ where: { id: input.command.subjectId }, select: { owningLabId: true } })
    : await prisma.cage.findUnique({ where: { id: input.command.subjectId }, select: { labId: true } });
  if (!subjectSnapshot) return { ok: false as const, code: "not_found", message: "The welfare subject was not found." };
  const targetLabId = "owningLabId" in subjectSnapshot ? subjectSnapshot.owningLabId : subjectSnapshot.labId;
  const caseId = `welfare-case-${createHash("sha256").update(`${input.actor.id}:${input.idempotencyKey.trim()}`).digest("hex").slice(0, 32)}`;
  return executeIdempotentCommand({
    actor: facilityScopedWelfareActor(input.actor),
    labId: targetLabId,
    authorizationLabId: null,
    commandType: "welfare.case.open",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: commandRequest(input.command),
    requiredCapability: "welfare:manage",
    aggregateType: "welfare_case",
    aggregateId: caseId,
    handler: async (tx, context) => {
      const evidence = await currentClinicalEvidence(tx, input.actor, ["designated_veterinarian", "welfare_officer"]);
      if (!evidence) return { ok: false, code: "clinical_duty_required", message: "A current verified veterinary or welfare duty is required." };
      const operationalSummary = text(input.command.operationalSummary, "Operational summary", 3, 160);
      const privateClinicalSummary = text(input.command.privateClinicalSummary, "Private clinical summary", 3, 2000);
      const subject = input.command.subjectType === "animal"
        ? await tx.animal.findUnique({ where: { id: input.command.subjectId }, select: { id: true, owningLabId: true, version: true } })
        : await tx.cage.findUnique({ where: { id: input.command.subjectId }, select: { id: true, labId: true, version: true } });
      if (!subject) return { ok: false, code: "not_found", message: "The welfare subject was not found." };
      const labId = "owningLabId" in subject ? subject.owningLabId : subject.labId;
      if (subject.version !== input.command.expectedSubjectVersion) {
        return staleConflict(input.command.subjectType, subject.id, input.command.expectedSubjectVersion, subject.version);
      }
      if (input.command.reopenedFromCaseId) {
        const prior = await tx.welfareCase.findUnique({ where: { id: input.command.reopenedFromCaseId } });
        if (!prior || !isTerminalWelfareCase(prior.status) || prior.labId !== labId
          || prior.subjectType !== input.command.subjectType
          || (input.command.subjectType === "animal" ? prior.animalId : prior.cageId) !== subject.id) {
          return { ok: false, code: "invalid_reopen", message: "Reopening must link the same subject's terminal case." };
        }
      }
      const welfareCase = await tx.welfareCase.create({
        data: {
          id: caseId,
          labId,
          subjectType: input.command.subjectType,
          animalId: input.command.subjectType === "animal" ? subject.id : null,
          cageId: input.command.subjectType === "cage" ? subject.id : null,
          reopenedFromCaseId: input.command.reopenedFromCaseId ?? null,
          severity: input.command.severity,
          operationalSummary,
          privateClinicalSummary,
          policyMarker: WELFARE_POLICY_MARKER,
          openedAt: input.command.openedAt,
          openedById: input.actor.id,
          openedCommandReceiptId: context.receiptId,
          lastCommandReceiptId: context.receiptId,
        },
      });
      await appendEvent(tx, {
        actor: input.actor, evidence, receiptId: context.receiptId, caseId, labId,
        eventType: "opened", fromStatus: null, toStatus: "open",
        detail: { subjectType: input.command.subjectType, severity: input.command.severity, reopened: Boolean(input.command.reopenedFromCaseId) },
      });
      return { ok: true, aggregateType: "welfare_case", aggregateId: caseId, resultingVersion: welfareCase.version, result: { caseId, version: welfareCase.version, message: "Welfare case opened." } };
    },
  });
}

async function caseCommand(input: CaseCommandIdentity & {
  actor: WelfareActor;
  commandType: string;
  requiredCapability?: "welfare:manage" | "welfare:close";
  allowedDuties: readonly FacilityDuty[];
  request: Prisma.InputJsonValue;
  mutate: (tx: Prisma.TransactionClient, context: { receiptId: string; welfareCase: Awaited<ReturnType<typeof loadCase>> & {}; evidence: NonNullable<Awaited<ReturnType<typeof currentClinicalEvidence>>> }) => Promise<{
    eventType: WelfareCaseEventType;
    nextStatus: WelfareCaseStatus;
    casePatch?: Prisma.WelfareCaseUpdateInput;
    detail?: Prisma.InputJsonValue;
    message: string;
  } | { error: string; code: string }>;
}) {
  const requiredCapability = input.requiredCapability ?? "welfare:manage";
  if (!await reauthorizeActorForCommand(prisma, facilityScopedWelfareActor(input.actor), requiredCapability, null)) {
    return { ok: false as const, code: "forbidden", message: "Your current authorization no longer permits this command." };
  }
  const target = await prisma.welfareCase.findUnique({ where: { id: input.caseId }, select: { labId: true } });
  if (!target) return { ok: false as const, code: "not_found", message: "The welfare case was not found." };
  return executeIdempotentCommand({
    actor: facilityScopedWelfareActor(input.actor),
    labId: target.labId,
    authorizationLabId: null,
    commandType: input.commandType,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: input.request,
    requiredCapability,
    aggregateType: "welfare_case",
    aggregateId: input.caseId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      const evidence = await currentClinicalEvidence(tx, input.actor, input.allowedDuties);
      if (!evidence) return { ok: false, code: "clinical_duty_required", message: "The required current verified clinical duty is unavailable." };
      const welfareCase = await loadCase(tx, input.caseId);
      if (!welfareCase || isTerminalWelfareCase(welfareCase.status)) return { ok: false, code: "invalid_state", message: "The welfare case is terminal or unavailable." };
      const fromStatus = welfareCase.status;
      const outcome = await input.mutate(tx, { receiptId: context.receiptId, welfareCase, evidence });
      if ("error" in outcome) return { ok: false, code: outcome.code, message: outcome.error };
      if (!canTransitionWelfareCase(fromStatus, outcome.nextStatus)) return invalidTransition(fromStatus, outcome.nextStatus);
      const updated = await tx.welfareCase.update({
        where: { id: welfareCase.id },
        data: {
          ...outcome.casePatch,
          status: outcome.nextStatus,
          lastCommandReceipt: { connect: { id: context.receiptId } },
          version: { increment: 1 },
        },
      });
      await appendEvent(tx, { actor: input.actor, evidence, receiptId: context.receiptId, caseId: welfareCase.id, labId: welfareCase.labId, eventType: outcome.eventType, fromStatus, toStatus: outcome.nextStatus, detail: outcome.detail });
      return { ok: true, aggregateType: "welfare_case", aggregateId: welfareCase.id, resultingVersion: updated.version, result: { caseId: welfareCase.id, version: updated.version, message: outcome.message } };
    },
  });
}

export function executeTriageWelfareCaseCommand(input: { actor: WelfareActor; triagedAt: Date } & CaseCommandIdentity) {
  return caseCommand({ ...input, commandType: "welfare.case.triage", allowedDuties: ["designated_veterinarian", "welfare_officer"], request: commandRequest({ triagedAt: input.triagedAt }), mutate: async (tx, { welfareCase }) => {
    if (welfareCase.status !== "open") return { error: "Only an open welfare case can be triaged.", code: "invalid_state" };
    return { eventType: "triaged", nextStatus: "triaged", casePatch: { triagedAt: input.triagedAt, triagedBy: { connect: { id: input.actor.id } } }, message: "Welfare case triaged." };
  } });
}

export function executeRecordWelfareObservationCommand(input: { actor: WelfareActor; observedAt: Date; severity: AlertSeverity; operationalCode: string; privateNote: string } & CaseCommandIdentity) {
  return caseCommand({ ...input, commandType: "welfare.observation.record", allowedDuties: ["designated_veterinarian", "welfare_officer"], request: commandRequest({ observedAt: input.observedAt, severity: input.severity, operationalCode: input.operationalCode, privateNote: input.privateNote }), mutate: async (tx, { receiptId, welfareCase }) => {
    if (!operationalCodes.has(input.operationalCode)) return { error: "Choose a supported operational observation code.", code: "invalid_input" };
    await tx.welfareObservation.create({ data: { id: `welfare-observation-${randomUUID()}`, caseId: welfareCase.id, labId: welfareCase.labId, observedAt: input.observedAt, severity: input.severity, operationalCode: input.operationalCode, privateNote: text(input.privateNote, "Private observation", 3, 2000), observedById: input.actor.id, commandReceiptId: receiptId } });
    const nextStatus = welfareCase.status === "escalated" || welfareCase.status === "treatment_ordered" ? welfareCase.status : "under_observation";
    return { eventType: "observation_recorded", nextStatus, detail: { severity: input.severity, operationalCode: input.operationalCode }, message: "Observation recorded." };
  } });
}

export function executeProposeWelfareTreatmentOrderCommand(input: { actor: WelfareActor; medication: string; dose: string; route: string; frequency: string; instructions: string; proposedAt: Date } & CaseCommandIdentity) {
  return caseCommand({ ...input, commandType: "welfare.treatment.propose", allowedDuties: ["designated_veterinarian"], request: commandRequest({ medication: input.medication, dose: input.dose, route: input.route, frequency: input.frequency, instructions: input.instructions, proposedAt: input.proposedAt }), mutate: async (tx, { receiptId, welfareCase }) => {
    if (welfareCase.status === "open") return { error: "Triage the case before proposing treatment.", code: "invalid_state" };
    const order = await tx.welfareTreatmentOrder.create({ data: { id: `welfare-order-${randomUUID()}`, caseId: welfareCase.id, labId: welfareCase.labId, medication: text(input.medication, "Medication", 2, 200), dose: text(input.dose, "Dose", 1, 120), route: text(input.route, "Route", 2, 120), frequency: text(input.frequency, "Frequency", 2, 160), instructions: text(input.instructions, "Instructions", 3, 2000), proposedAt: input.proposedAt, proposedById: input.actor.id, proposedCommandReceiptId: receiptId, lastCommandReceiptId: receiptId } });
    return { eventType: "treatment_ordered", nextStatus: "treatment_ordered", detail: { orderId: order.id }, message: "Treatment order proposed for veterinarian approval." };
  } });
}

export function executeApproveWelfareTreatmentOrderCommand(input: { actor: WelfareActor; orderId: string; expectedOrderVersion: number; approvedAt: Date } & CaseCommandIdentity) {
  return caseCommand({ ...input, commandType: "welfare.treatment.approve", allowedDuties: ["designated_veterinarian"], request: commandRequest({ orderId: input.orderId, expectedOrderVersion: input.expectedOrderVersion, approvedAt: input.approvedAt }), mutate: async (tx, { receiptId, welfareCase }) => {
    const order = welfareCase.treatmentOrders.find((candidate) => candidate.id === input.orderId);
    if (!order || order.version !== input.expectedOrderVersion || !canTransitionWelfareOrder(order.status, "approved")) return { error: "The treatment order is unavailable, stale, or not approvable.", code: "invalid_state" };
    await tx.welfareTreatmentOrder.update({ where: { id: order.id }, data: { status: "approved", approvedAt: input.approvedAt, approvedById: input.actor.id, lastCommandReceiptId: receiptId, version: { increment: 1 } } });
    return { eventType: "treatment_approved", nextStatus: "treatment_ordered", detail: { orderId: order.id }, message: "Treatment order approved." };
  } });
}

export function executeRecordWelfareAdministrationCommand(input: { actor: WelfareActor; orderId: string; expectedOrderVersion: number; administeredAt: Date; outcome: WelfareAdministrationOutcome; actualDose?: string | null; privateNote?: string | null } & CaseCommandIdentity) {
  return caseCommand({ ...input, commandType: "welfare.treatment.administer", allowedDuties: ["designated_veterinarian"], request: commandRequest(input), mutate: async (tx, { receiptId, welfareCase }) => {
    const order = welfareCase.treatmentOrders.find((candidate) => candidate.id === input.orderId);
    if (!order || order.version !== input.expectedOrderVersion || !isAdministrableOrder(order.status)) return { error: "Administration requires a current approved or active treatment order.", code: "invalid_state" };
    if (input.outcome === "administered" && !input.actualDose?.trim()) return { error: "Record the actual administered dose.", code: "invalid_input" };
    await tx.welfareAdministrationAttempt.create({ data: { id: `welfare-administration-${randomUUID()}`, caseId: welfareCase.id, orderId: order.id, labId: welfareCase.labId, administeredAt: input.administeredAt, outcome: input.outcome, actualDose: input.actualDose?.trim() || null, privateNote: input.privateNote?.trim() || null, administeredById: input.actor.id, commandReceiptId: receiptId } });
    await tx.welfareTreatmentOrder.update({ where: { id: order.id }, data: { status: "active", lastCommandReceiptId: receiptId, version: { increment: 1 } } });
    return { eventType: "administration_recorded", nextStatus: "treatment_ordered", detail: { orderId: order.id, outcome: input.outcome }, message: "Administration attempt recorded." };
  } });
}

export function executeStopWelfareTreatmentOrderCommand(input: { actor: WelfareActor; orderId: string; expectedOrderVersion: number; stoppedAt: Date; reason: string } & CaseCommandIdentity) {
  return caseCommand({ ...input, commandType: "welfare.treatment.stop", allowedDuties: ["designated_veterinarian"], request: commandRequest({ orderId: input.orderId, expectedOrderVersion: input.expectedOrderVersion, stoppedAt: input.stoppedAt, reason: input.reason }), mutate: async (tx, { receiptId, welfareCase }) => {
    const order = welfareCase.treatmentOrders.find((candidate) => candidate.id === input.orderId);
    if (!order || order.version !== input.expectedOrderVersion || !canTransitionWelfareOrder(order.status, "stopped")) return { error: "The treatment order is unavailable, stale, or cannot be stopped.", code: "invalid_state" };
    await tx.welfareTreatmentOrder.update({ where: { id: order.id }, data: { status: "stopped", stoppedAt: input.stoppedAt, stoppedById: input.actor.id, stopReason: text(input.reason, "Stop reason", 3, 1000), lastCommandReceiptId: receiptId, version: { increment: 1 } } });
    const otherActive = welfareCase.treatmentOrders.some((candidate) => candidate.id !== order.id && ["proposed", "approved", "active"].includes(candidate.status));
    return { eventType: "treatment_stopped", nextStatus: otherActive ? "treatment_ordered" : "under_observation", detail: { orderId: order.id }, message: "Treatment order stopped." };
  } });
}

export function executeCompleteWelfareTreatmentOrderCommand(input: { actor: WelfareActor; orderId: string; expectedOrderVersion: number; completedAt: Date } & CaseCommandIdentity) {
  return caseCommand({ ...input, commandType: "welfare.treatment.complete", allowedDuties: ["designated_veterinarian"], request: commandRequest({ orderId: input.orderId, expectedOrderVersion: input.expectedOrderVersion, completedAt: input.completedAt }), mutate: async (tx, { receiptId, welfareCase }) => {
    const order = welfareCase.treatmentOrders.find((candidate) => candidate.id === input.orderId);
    if (!order || order.version !== input.expectedOrderVersion || !canTransitionWelfareOrder(order.status, "completed")) return { error: "The treatment order is unavailable, stale, or cannot be completed.", code: "invalid_state" };
    await tx.welfareTreatmentOrder.update({ where: { id: order.id }, data: { status: "completed", completedAt: input.completedAt, lastCommandReceiptId: receiptId, version: { increment: 1 } } });
    const otherActive = welfareCase.treatmentOrders.some((candidate) => candidate.id !== order.id && ["proposed", "approved", "active"].includes(candidate.status));
    return { eventType: "treatment_completed", nextStatus: otherActive ? "treatment_ordered" : "under_observation", detail: { orderId: order.id }, message: "Treatment order completed." };
  } });
}

export function executeCancelWelfareTreatmentOrderCommand(input: { actor: WelfareActor; orderId: string; expectedOrderVersion: number; cancelledAt: Date; reason: string } & CaseCommandIdentity) {
  return caseCommand({ ...input, commandType: "welfare.treatment.cancel", allowedDuties: ["designated_veterinarian"], request: commandRequest({ orderId: input.orderId, expectedOrderVersion: input.expectedOrderVersion, cancelledAt: input.cancelledAt, reason: input.reason }), mutate: async (tx, { receiptId, welfareCase }) => {
    const order = welfareCase.treatmentOrders.find((candidate) => candidate.id === input.orderId);
    if (!order || order.version !== input.expectedOrderVersion || !canTransitionWelfareOrder(order.status, "cancelled")) return { error: "Only a current proposed treatment order can be cancelled.", code: "invalid_state" };
    await tx.welfareTreatmentOrder.update({ where: { id: order.id }, data: { status: "cancelled", stoppedAt: input.cancelledAt, stoppedById: input.actor.id, stopReason: text(input.reason, "Cancellation reason", 3, 1000), lastCommandReceiptId: receiptId, version: { increment: 1 } } });
    const otherActive = welfareCase.treatmentOrders.some((candidate) => candidate.id !== order.id && ["proposed", "approved", "active"].includes(candidate.status));
    return { eventType: "treatment_stopped", nextStatus: otherActive ? "treatment_ordered" : "under_observation", detail: { orderId: order.id, cancellation: true }, message: "Proposed treatment order cancelled." };
  } });
}

export function executeOpenWelfareEscalationCommand(input: { actor: WelfareActor; severity: AlertSeverity; operationalCode: string; privateReason: string; openedAt: Date } & CaseCommandIdentity) {
  return caseCommand({ ...input, commandType: "welfare.escalation.open", allowedDuties: ["designated_veterinarian", "welfare_officer"], request: commandRequest({ severity: input.severity, operationalCode: input.operationalCode, privateReason: input.privateReason, openedAt: input.openedAt }), mutate: async (tx, { receiptId, welfareCase }) => {
    if (!escalationCodes.has(input.operationalCode)) return { error: "Choose a supported escalation code.", code: "invalid_input" };
    const escalation = await tx.welfareEscalation.create({ data: { id: `welfare-escalation-${randomUUID()}`, caseId: welfareCase.id, labId: welfareCase.labId, severity: input.severity, operationalCode: input.operationalCode, privateReason: text(input.privateReason, "Private escalation reason", 3, 2000), openedAt: input.openedAt, openedById: input.actor.id, openedCommandReceiptId: receiptId, lastCommandReceiptId: receiptId } });
    return { eventType: "escalated", nextStatus: "escalated", detail: { escalationId: escalation.id, severity: input.severity, operationalCode: input.operationalCode }, message: "Escalation opened." };
  } });
}

export function executeAcknowledgeWelfareEscalationCommand(input: { actor: WelfareActor; escalationId: string; expectedEscalationVersion: number; acknowledgedAt: Date } & CaseCommandIdentity) {
  return caseCommand({ ...input, commandType: "welfare.escalation.acknowledge", allowedDuties: ["designated_veterinarian", "welfare_officer"], request: commandRequest({ escalationId: input.escalationId, expectedEscalationVersion: input.expectedEscalationVersion, acknowledgedAt: input.acknowledgedAt }), mutate: async (tx, { receiptId, welfareCase }) => {
    const escalation = welfareCase.escalations.find((candidate) => candidate.id === input.escalationId);
    if (!escalation || escalation.version !== input.expectedEscalationVersion || !canTransitionWelfareEscalation(escalation.status, "acknowledged")) return { error: "The escalation is unavailable, stale, or already acknowledged.", code: "invalid_state" };
    await tx.welfareEscalation.update({ where: { id: escalation.id }, data: { status: "acknowledged", acknowledgedAt: input.acknowledgedAt, acknowledgedById: input.actor.id, lastCommandReceiptId: receiptId, version: { increment: 1 } } });
    return { eventType: "escalation_acknowledged", nextStatus: "escalated", detail: { escalationId: escalation.id, severity: escalation.severity }, message: "Escalation acknowledged." };
  } });
}

export function executeResolveWelfareEscalationCommand(input: { actor: WelfareActor; escalationId: string; expectedEscalationVersion: number; resolvedAt: Date; resolutionNote: string } & CaseCommandIdentity) {
  return caseCommand({ ...input, commandType: "welfare.escalation.resolve", allowedDuties: ["designated_veterinarian"], request: commandRequest({ escalationId: input.escalationId, expectedEscalationVersion: input.expectedEscalationVersion, resolvedAt: input.resolvedAt, resolutionNote: input.resolutionNote }), mutate: async (tx, { receiptId, welfareCase }) => {
    const escalation = welfareCase.escalations.find((candidate) => candidate.id === input.escalationId);
    if (!escalation || escalation.version !== input.expectedEscalationVersion || !canTransitionWelfareEscalation(escalation.status, "resolved")) return { error: "The escalation must be acknowledged before veterinarian resolution.", code: "invalid_state" };
    await tx.welfareEscalation.update({ where: { id: escalation.id }, data: { status: "resolved", resolvedAt: input.resolvedAt, resolvedById: input.actor.id, resolutionNote: text(input.resolutionNote, "Resolution note", 3, 2000), lastCommandReceiptId: receiptId, version: { increment: 1 } } });
    const unresolvedOther = welfareCase.escalations.some((candidate) => candidate.id !== escalation.id && candidate.status !== "resolved");
    const activeOrder = welfareCase.treatmentOrders.some((candidate) => ["proposed", "approved", "active"].includes(candidate.status));
    return { eventType: "escalation_resolved", nextStatus: unresolvedOther ? "escalated" : activeOrder ? "treatment_ordered" : "under_observation", detail: { escalationId: escalation.id }, message: "Escalation resolved." };
  } });
}

export function executeCloseWelfareCaseCommand(input: { actor: WelfareActor; closedAt: Date; closureReason: string } & CaseCommandIdentity) {
  return caseCommand({ ...input, commandType: "welfare.case.close", requiredCapability: "welfare:close", allowedDuties: ["designated_veterinarian"], request: commandRequest({ closedAt: input.closedAt, closureReason: input.closureReason }), mutate: async (tx, { welfareCase }) => {
    if (welfareCase.escalations.some((candidate) => candidate.status !== "resolved")) return { error: "Acknowledge and resolve every escalation before closing the case.", code: "unresolved_escalation" };
    if (welfareCase.treatmentOrders.some((candidate) => ["proposed", "approved", "active"].includes(candidate.status))) return { error: "Stop or complete every treatment order before closing the case.", code: "unsettled_treatment" };
    return { eventType: "closed", nextStatus: "closed", casePatch: { closedAt: input.closedAt, closedBy: { connect: { id: input.actor.id } }, closureReason: text(input.closureReason, "Closure reason", 3, 2000) }, detail: { closureRecorded: true }, message: "Welfare case closed by the designated veterinarian." };
  } });
}

export function executeCancelWelfareCaseCommand(input: { actor: WelfareActor; cancelledAt: Date; cancellationCode: typeof WELFARE_CANCELLATION_CODES[number]; cancellationReason: string } & CaseCommandIdentity) {
  return caseCommand({ ...input, commandType: "welfare.case.cancel", allowedDuties: ["designated_veterinarian", "welfare_officer"], request: commandRequest({ cancelledAt: input.cancelledAt, cancellationCode: input.cancellationCode, cancellationReason: input.cancellationReason }), mutate: async (tx, { welfareCase }) => {
    if (!WELFARE_CANCELLATION_CODES.includes(input.cancellationCode)) return { error: "Cancellation is limited to duplicate or not-a-case records.", code: "invalid_input" };
    if (welfareCase.status !== "open" || welfareCase.triagedAt || welfareCase.observations.length
      || welfareCase.treatmentOrders.length || welfareCase.administrationAttempts.length || welfareCase.escalations.length) {
      return { error: "Only a pristine, open, untriaged case without clinical activity can be cancelled.", code: "case_not_pristine" };
    }
    return { eventType: "cancelled", nextStatus: "cancelled", casePatch: { cancelledAt: input.cancelledAt, cancelledBy: { connect: { id: input.actor.id } }, cancellationCode: input.cancellationCode, cancellationReason: text(input.cancellationReason, "Cancellation reason", 3, 1000) }, detail: { cancellationCode: input.cancellationCode }, message: "Welfare case cancelled." };
  } });
}
