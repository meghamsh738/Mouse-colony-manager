import { getActorCapabilities } from "../src/lib/capabilities";
import { executeDecideCorrectionRequest, executeSubmitCorrectionRequest } from "../src/lib/correction-write";
import { prisma } from "../src/lib/prisma";
import type { ResolvedActor } from "../src/lib/session";

async function actor(userId: string, activeLabId: string | null, duties: ResolvedActor["activeDuties"]): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const identity = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId, active: true } });
  const canonicalRole = user.role === "facility_admin" ? "facility_admin" as const : "lab_user" as const;
  const membership = activeLabId ? await prisma.labMembership.findFirstOrThrow({ where: { userId, labId: activeLabId, active: true }, include: { lab: true } }) : null;
  const activeMembership = membership ? { labId: membership.labId, labName: membership.lab.name, labCode: membership.lab.code, role: membership.role } : null;
  return {
    id: user.id, email: user.email, name: user.name, role: canonicalRole === "facility_admin" ? "admin" : "animal_staff", databaseRole: user.role,
    canonicalRole, authzVersion: user.authzVersion, authMethod: "synthetic_mfa", assurance: "synthetic_mfa",
    authenticatedAt: new Date().toISOString(), identityLinkId: identity.id, activeDuties: duties,
    activeLabId, activeMembership, memberships: activeMembership ? [activeMembership] : [],
    capabilities: [...getActorCapabilities({ canonicalRole, activeMembership, activeDuties: duties })],
  };
}

export async function seedCorrectionQaFixture() {
  const requester = await actor("user-lab-manager-qa", "lab-microglia", []);
  const steward = await actor("user-facility-admin-approver-qa", null, ["training_administrator", "data_steward"]);
  const submitted = await executeSubmitCorrectionRequest({
    actor: requester,
    idempotencyKey: "role-qa-correction-submit-v1",
    requestId: "role-qa-correction-submit-request-v1",
    command: {
      labId: "lab-microglia",
      domain: "animal_move",
      targetEntityId: "move-001",
      sourceEventAt: new Date("2026-03-24T11:00:00.000Z"),
      reason: "Synthetic QA metadata correction for movement provenance.",
      proposedCorrection: { movedAt: "2026-03-24T11:05:00.000Z", reason: "Synthetic corrected movement reason." },
    },
  });
  if (!submitted.ok || !submitted.result || typeof submitted.result !== "object" || Array.isArray(submitted.result)) {
    throw new Error(`Could not create the synthetic correction request: ${submitted.message ?? "unknown error"}`);
  }
  const correctionId = String((submitted.result as { correctionId: unknown }).correctionId);
  const decided = await executeDecideCorrectionRequest({
    actor: steward,
    correctionId,
    expectedVersion: 1,
    decision: "approve",
    decisionReason: "Independent synthetic Data Steward review accepted the metadata-only supersession.",
    idempotencyKey: "role-qa-correction-apply-v1",
    requestId: "role-qa-correction-apply-request-v1",
  });
  if (!decided.ok) throw new Error(`Could not apply the synthetic correction request: ${decided.message ?? "unknown error"}`);
}
