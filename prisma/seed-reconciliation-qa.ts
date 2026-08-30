import { getActorCapabilities } from "../src/lib/capabilities";
import { prisma } from "../src/lib/prisma";
import {
  executeCreateShipmentManifestCommand,
  executeRecordCensusObservationCommand,
  executeStartCensusSessionCommand,
} from "../src/lib/reconciliation-write";
import type { ResolvedActor } from "../src/lib/session";

async function managerActor(): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: "user-lab-manager-qa" } });
  const membership = await prisma.labMembership.findFirstOrThrow({ where: { userId: user.id, labId: "lab-microglia", active: true }, include: { lab: true } });
  const identity = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId: user.id, active: true } });
  const activeMembership = { labId: membership.labId, labName: membership.lab.name, labCode: membership.lab.code, role: membership.role };
  return {
    id: user.id, email: user.email, name: user.name, role: "animal_staff", databaseRole: user.role,
    canonicalRole: "lab_user", authzVersion: user.authzVersion,
    authMethod: "synthetic_mfa", assurance: "synthetic_mfa", authenticatedAt: new Date().toISOString(), identityLinkId: identity.id,
    activeDuties: [], activeLabId: membership.labId, activeMembership, memberships: [activeMembership],
    capabilities: [...getActorCapabilities({ canonicalRole: "lab_user", activeMembership, activeDuties: [] })],
  };
}

function resultId(result: { ok: boolean; result?: unknown; message?: string }, key: string) {
  if (!result.ok || !result.result || typeof result.result !== "object" || Array.isArray(result.result)) {
    throw new Error(`Could not seed M16 ${key}: ${result.message ?? "unknown command error"}`);
  }
  return String((result.result as Record<string, unknown>)[key]);
}

export async function seedReconciliationQaFixture() {
  const actor = await managerActor();
  const [protocol, strain, room] = await Promise.all([
    prisma.protocolAuthorization.findFirstOrThrow({ where: { labId: "lab-microglia", status: "active" }, orderBy: { protocolCode: "asc" } }),
    prisma.strain.findFirstOrThrow({ orderBy: { name: "asc" } }),
    prisma.room.findFirstOrThrow({ orderBy: { roomNumber: "asc" } }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const manifest = await executeCreateShipmentManifestCommand({
    actor,
    idempotencyKey: "role-qa-m16-manifest-create-v1",
    requestId: "role-qa-m16-manifest-create-request-v1",
    command: {
      labId: "lab-microglia", sourceType: "vendor", sourceName: "Synthetic QA Vendor", externalReference: "M16-QA-EXPECTED-001",
      expectedAt: today, healthEvidenceStatus: "missing", protocolAuthorizationId: protocol.id,
      items: [{ expectedIdentifier: "M16-QA-SOURCE-001", strainId: strain.id, expectedSex: "female", expectedDob: today }],
    },
  });
  resultId(manifest, "manifestId");

  const census = await executeStartCensusSessionCommand({
    actor,
    idempotencyKey: "role-qa-m16-census-start-v1",
    requestId: "role-qa-m16-census-start-request-v1",
    command: { labId: "lab-microglia", roomId: room.id, rackLabel: "Synthetic QA rack", ownerId: actor.id },
  });
  const censusId = resultId(census, "censusId");
  const observation = await executeRecordCensusObservationCommand({
    actor, sessionId: censusId, expectedVersion: 1,
    idempotencyKey: "role-qa-m16-census-observe-v1",
    requestId: "role-qa-m16-census-observe-request-v1",
    observation: { observedIdentifier: "M16-QA-UNKNOWN-CAGE", outcome: "unknown", discrepancyCodes: ["unknown"], operationalCondition: "Synthetic unknown barcode for discrepancy workflow QA." },
  });
  if (!observation.ok) throw new Error(`Could not seed M16 census observation: ${observation.message ?? "unknown command error"}`);
}
