import { getActorCapabilities } from "../src/lib/capabilities";
import type { ResolvedActor } from "../src/lib/session";
import {
  executeOpenWelfareCaseCommand,
  executeProposeWelfareTreatmentOrderCommand,
  executeRecordWelfareObservationCommand,
  executeTriageWelfareCaseCommand,
} from "../src/lib/welfare-write";
import { prisma } from "../src/lib/prisma";

async function veterinarianActor(): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: "user-veterinarian-qa" } });
  const identity = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId: user.id, active: true } });
  return {
    id: user.id, email: user.email, name: user.name, role: "read_only", databaseRole: user.role,
    canonicalRole: "lab_user", authzVersion: user.authzVersion,
    authMethod: "synthetic_mfa", assurance: "synthetic_mfa", authenticatedAt: new Date().toISOString(),
    identityLinkId: identity.id, activeDuties: ["designated_veterinarian"], activeLabId: null,
    activeMembership: null, memberships: [],
    capabilities: [...getActorCapabilities({ canonicalRole: "lab_user", activeMembership: null, activeDuties: ["designated_veterinarian"] })],
  };
}

export async function seedWelfareQaFixture() {
  const actor = await veterinarianActor();
  const animal = await prisma.animal.findUniqueOrThrow({ where: { id: "animal-014" }, select: { id: true, version: true } });
  const opened = await executeOpenWelfareCaseCommand({
    actor,
    idempotencyKey: "role-qa-welfare-open-v1",
    requestId: "role-qa-welfare-open-request-v1",
    command: {
      subjectType: "animal", subjectId: animal.id, expectedSubjectVersion: animal.version,
      severity: "warning", operationalSummary: "Synthetic post-procedure condition review",
      privateClinicalSummary: "Synthetic QA-only clinical context; not an institutional clinical record.",
      openedAt: new Date(),
    },
  });
  if (!opened.ok || !opened.result || typeof opened.result !== "object" || Array.isArray(opened.result)) {
    throw new Error(`Could not create the synthetic welfare QA case: ${opened.message ?? "unknown error"}`);
  }
  const caseId = String((opened.result as { caseId: unknown }).caseId);
  const triaged = await executeTriageWelfareCaseCommand({ actor, caseId, expectedVersion: 1, triagedAt: new Date(), idempotencyKey: "role-qa-welfare-triage-v1", requestId: "role-qa-welfare-triage-request-v1" });
  if (!triaged.ok) throw new Error(`Could not triage the synthetic welfare QA case: ${triaged.message ?? "unknown error"}`);
  const observed = await executeRecordWelfareObservationCommand({ actor, caseId, expectedVersion: 2, observedAt: new Date(), severity: "warning", operationalCode: "post_procedure", privateNote: "Synthetic observation for role and privacy QA.", idempotencyKey: "role-qa-welfare-observe-v1", requestId: "role-qa-welfare-observe-request-v1" });
  if (!observed.ok) throw new Error(`Could not observe the synthetic welfare QA case: ${observed.message ?? "unknown error"}`);
  const ordered = await executeProposeWelfareTreatmentOrderCommand({ actor, caseId, expectedVersion: 3, proposedAt: new Date(), medication: "Synthetic QA compound", dose: "1 synthetic unit", route: "documented synthetic route", frequency: "once daily", instructions: "Synthetic-only QA instructions.", idempotencyKey: "role-qa-welfare-order-v1", requestId: "role-qa-welfare-order-request-v1" });
  if (!ordered.ok) throw new Error(`Could not create the synthetic welfare QA order: ${ordered.message ?? "unknown error"}`);
}
