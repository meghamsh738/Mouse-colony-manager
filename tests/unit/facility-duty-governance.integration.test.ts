import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getActorCapabilities } from "@/lib/capabilities";
import { reauthorizeActorForCommand } from "@/lib/command-foundation";
import { assertDestructiveSeedAllowed } from "@/lib/destructive-seed-guard";
import {
  decideFacilityDutyRequest,
  requestFacilityDutyGrant,
  requestFacilityDutyRevoke,
  type DutyGovernanceActor,
} from "@/lib/facility-duty-governance";
import { isElevatedIdentityContextCurrent } from "@/lib/identity-assurance";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { SEEDED_ROLE_QA_EMAILS } from "@/lib/seed-metadata";

const runId = randomUUID();
const ids = {
  admin1: `m12-admin-1-${runId}`,
  admin2: `m12-admin-2-${runId}`,
  target1: `m12-target-1-${runId}`,
  target2: `m12-target-2-${runId}`,
  admin1Link: `m12-link-admin-1-${runId}`,
  admin2Link: `m12-link-admin-2-${runId}`,
};
const userIds = [ids.admin1, ids.admin2, ids.target1, ids.target2];
const previousProfile = process.env.MCM_DEPLOYMENT_PROFILE;

async function cleanup() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.facilityDutyLifecycleEvent.deleteMany({ where: { targetUserId: { in: userIds } } });
    await tx.facilityDutyAssignment.deleteMany({ where: { userId: { in: userIds } } });
    await tx.facilityDutyRequest.deleteMany({
      where: { OR: [{ targetUserId: { in: userIds } }, { requestedById: { in: userIds } }, { decidedById: { in: userIds } }] },
    });
    await tx.externalIdentityLifecycleEvent.deleteMany({ where: { identityLink: { userId: { in: userIds } } } });
    await tx.externalIdentityLink.deleteMany({ where: { userId: { in: userIds } } });
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function adminActor(id: typeof ids.admin1 | typeof ids.admin2): Promise<DutyGovernanceActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: { authzVersion: true, email: true } });
  return {
    id,
    email: user.email,
    canonicalRole: "facility_admin",
    authzVersion: user.authzVersion,
    authMethod: "synthetic_mfa",
    assurance: "synthetic_mfa",
    authenticatedAt: new Date().toISOString(),
    identityLinkId: id === ids.admin1 ? ids.admin1Link : ids.admin2Link,
  };
}

async function approveWithOtherAdmin(requestId: string, requesterId: string) {
  const request = await prisma.facilityDutyRequest.findUniqueOrThrow({ where: { id: requestId }, select: { version: true } });
  const deciderId = requesterId === ids.admin1 ? ids.admin2 : ids.admin1;
  return decideFacilityDutyRequest({ requestId, expectedVersion: request.version, decision: "approve" }, await adminActor(deciderId));
}

describe.sequential("facility duty governance database contract", () => {
  beforeAll(async () => {
    assertDestructiveSeedAllowed();
    process.env.MCM_DEPLOYMENT_PROFILE = "synthetic";
    await cleanup();
    await prisma.user.createMany({
      data: [
        { id: ids.admin1, name: "M12 Admin One", email: SEEDED_ROLE_QA_EMAILS.facilityAdmin, passwordHash: hashPassword("m12-integration-password"), role: "facility_admin" },
        { id: ids.admin2, name: "M12 Admin Two", email: SEEDED_ROLE_QA_EMAILS.facilityAdminApprover, passwordHash: hashPassword("m12-integration-password"), role: "facility_admin" },
        { id: ids.target1, name: "M12 Duty Holder", email: SEEDED_ROLE_QA_EMAILS.veterinarian, passwordHash: hashPassword("m12-integration-password"), role: "lab_user" },
        { id: ids.target2, name: "M12 Concurrent Holder", email: SEEDED_ROLE_QA_EMAILS.cmuStaff, passwordHash: hashPassword("m12-integration-password"), role: "lab_user" },
      ],
    });
    await prisma.externalIdentityLink.createMany({
      data: [
        { id: ids.admin1Link, userId: ids.admin1, provider: "synthetic", providerSubject: SEEDED_ROLE_QA_EMAILS.facilityAdmin, assurance: "synthetic_mfa", linkedById: ids.admin1 },
        { id: ids.admin2Link, userId: ids.admin2, provider: "synthetic", providerSubject: SEEDED_ROLE_QA_EMAILS.facilityAdminApprover, assurance: "synthetic_mfa", linkedById: ids.admin1 },
      ],
    });
    await prisma.externalIdentityLifecycleEvent.createMany({
      data: [
        { id: `m12-link-event-1-${runId}`, identityLinkId: ids.admin1Link, actorId: ids.admin1, eventType: "linked", assurance: "synthetic_mfa" },
        { id: `m12-link-event-2-${runId}`, identityLinkId: ids.admin2Link, actorId: ids.admin1, eventType: "linked", assurance: "synthetic_mfa" },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    if (previousProfile === undefined) delete process.env.MCM_DEPLOYMENT_PROFILE;
    else process.env.MCM_DEPLOYMENT_PROFILE = previousProfile;
  }, 120_000);

  it("allows self-request but rejects requester/target approval", async () => {
    const now = new Date();
    const requester = await adminActor(ids.admin1);
    const requested = await requestFacilityDutyGrant({
      targetUserId: ids.admin1,
      duty: "protocol_reviewer",
      validFrom: now,
      validUntil: new Date(now.getTime() + 60 * 60 * 1_000),
      reason: "Self-request for independently reviewed protocol coverage",
    }, requester);
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    const selfDecision = await decideFacilityDutyRequest({
      requestId: requested.entityId,
      expectedVersion: 1,
      decision: "approve",
    }, requester);
    expect(selfDecision).toMatchObject({ ok: false, message: expect.stringContaining("different Facility Admin") });
    expect((await approveWithOtherAdmin(requested.entityId, ids.admin1)).ok).toBe(true);
  });

  it("grants and revokes a duty while command reauthorization observes duty loss and lab isolation", async () => {
    const now = new Date();
    const requested = await requestFacilityDutyGrant({
      targetUserId: ids.target1,
      duty: "designated_veterinarian",
      validFrom: now,
      validUntil: new Date(now.getTime() + 60 * 60 * 1_000),
      reason: "Veterinary welfare coverage for the integration test",
    }, await adminActor(ids.admin1));
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    expect((await decideFacilityDutyRequest({ requestId: requested.entityId, expectedVersion: 1, decision: "approve" }, {
      id: ids.target1,
      email: SEEDED_ROLE_QA_EMAILS.veterinarian,
      canonicalRole: "lab_user",
      authzVersion: 1,
    })).ok).toBe(false);
    expect((await approveWithOtherAdmin(requested.entityId, ids.admin1)).ok).toBe(true);

    const assignment = await prisma.facilityDutyAssignment.findUniqueOrThrow({ where: { grantRequestId: requested.entityId } });
    const holder = await prisma.user.findUniqueOrThrow({ where: { id: ids.target1 }, select: { authzVersion: true } });
    const commandActor = { id: ids.target1, authzVersion: holder.authzVersion, activeLabId: null };
    expect(await reauthorizeActorForCommand(prisma, commandActor, "welfare:manage", null)).toBe(true);
    expect(await reauthorizeActorForCommand(prisma, commandActor, "animals:read", null)).toBe(false);
    expect(await reauthorizeActorForCommand(prisma, commandActor, "welfare:manage", "private-lab")).toBe(false);
    expect(getActorCapabilities({ canonicalRole: "lab_user", activeMembership: null, activeDuties: ["designated_veterinarian"] }).has("animals:read")).toBe(false);

    const revoke = await requestFacilityDutyRevoke({
      assignmentId: assignment.id,
      assignmentVersion: assignment.version,
      reason: "End veterinary coverage after the test decision",
    }, await adminActor(ids.admin1));
    expect(revoke.ok).toBe(true);
    if (!revoke.ok) return;
    expect((await approveWithOtherAdmin(revoke.entityId, ids.admin1)).ok).toBe(true);
    expect(await reauthorizeActorForCommand(prisma, commandActor, "welfare:manage", null)).toBe(false);
  });

  it("expires stale snapshots and rejects malformed assurance evidence directly", async () => {
    const now = new Date();
    const requested = await requestFacilityDutyGrant({
      targetUserId: ids.target2,
      duty: "data_steward",
      validFrom: now,
      validUntil: new Date(now.getTime() + 60 * 60 * 1_000),
      reason: "Exercise stale target authorization snapshots",
    }, await adminActor(ids.admin1));
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    await prisma.user.update({ where: { id: ids.target2 }, data: { authzVersion: { increment: 1 } } });
    expect((await decideFacilityDutyRequest({ requestId: requested.entityId, expectedVersion: 1, decision: "approve" }, await adminActor(ids.admin2))).ok).toBe(false);
    expect(await prisma.facilityDutyRequest.findUniqueOrThrow({ where: { id: requested.entityId }, select: { status: true } })).toEqual({ status: "expired" });

    const admin = await adminActor(ids.admin1);
    const target = await prisma.user.findUniqueOrThrow({ where: { id: ids.target2 }, select: { authzVersion: true } });
    await expect(prisma.$executeRaw(Prisma.sql`
      INSERT INTO "FacilityDutyRequest" (
        id, "requestType", duty, "targetUserId", "targetAuthzVersion", "requestedValidFrom", "requestedValidUntil",
        reason, "requestedById", "requestedByAuthzVersion", "requestedAssurance", "requestedIdentityLinkId",
        "requestedAuthenticatedAt", "expiresAt"
      ) VALUES (
        ${`m12-bad-evidence-${runId}`}, 'grant'::"FacilityDutyRequestType", 'welfare_officer'::"FacilityDuty", ${ids.target2}, ${target.authzVersion},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 hour', 'Reject mismatched identity evidence', ${ids.admin1}, ${admin.authzVersion},
        'synthetic_mfa'::"IdentityAssuranceLevel", ${ids.admin2Link}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 hour'
      )
    `)).rejects.toThrow(/assurance evidence.*mismatched/i);
  });

  it("serializes concurrent requests and rejects an overlapping direct assignment", async () => {
    const validFrom = new Date();
    const validUntil = new Date(validFrom.getTime() + 2 * 60 * 60 * 1_000);
    const results = await Promise.all([
      requestFacilityDutyGrant({ targetUserId: ids.target2, duty: "welfare_officer", validFrom, validUntil, reason: "First concurrent welfare request" }, await adminActor(ids.admin1)),
      requestFacilityDutyGrant({ targetUserId: ids.target2, duty: "welfare_officer", validFrom, validUntil, reason: "Second concurrent welfare request" }, await adminActor(ids.admin2)),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    const winner = results.find((result) => result.ok);
    if (!winner?.ok) return;
    const winningRequest = await prisma.facilityDutyRequest.findUniqueOrThrow({ where: { id: winner.entityId } });
    expect((await approveWithOtherAdmin(winner.entityId, winningRequest.requestedById)).ok).toBe(true);

    const requester = await adminActor(ids.admin1);
    const decider = await adminActor(ids.admin2);
    const target = await prisma.user.findUniqueOrThrow({ where: { id: ids.target2 }, select: { authzVersion: true } });
    const overlapRequestId = `m12-overlap-request-${runId}`;
    await prisma.facilityDutyRequest.create({
      data: {
        id: overlapRequestId,
        requestType: "grant",
        duty: "welfare_officer",
        targetUserId: ids.target2,
        targetAuthzVersion: target.authzVersion,
        requestedValidFrom: validFrom,
        requestedValidUntil: validUntil,
        reason: "Direct overlap trigger verification",
        requestedById: requester.id,
        requestedByAuthzVersion: requester.authzVersion,
        requestedAssurance: "synthetic_mfa",
        requestedIdentityLinkId: requester.identityLinkId!,
        requestedAuthenticatedAt: new Date(requester.authenticatedAt!),
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      },
    });
    await prisma.facilityDutyRequest.update({
      where: { id: overlapRequestId },
      data: {
        status: "approved",
        decidedById: decider.id,
        decidedByAuthzVersion: decider.authzVersion,
        decidedAssurance: "synthetic_mfa",
        decidedIdentityLinkId: decider.identityLinkId,
        decidedAuthenticatedAt: new Date(decider.authenticatedAt!),
        decidedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await expect(prisma.facilityDutyAssignment.create({
      data: {
        id: `m12-overlap-assignment-${runId}`,
        userId: ids.target2,
        duty: "welfare_officer",
        validFrom,
        validUntil,
        grantRequestId: overlapRequestId,
      },
    })).rejects.toThrow(/cannot overlap/i);
  });

  it("invalidates sessions atomically when an assurance link is revoked", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: ids.admin1 }, select: { authzVersion: true } });
    const context = await adminActor(ids.admin1);
    await prisma.externalIdentityLink.update({
      where: { id: ids.admin1Link },
      data: { active: false, revokedAt: new Date(), version: { increment: 1 } },
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: ids.admin1 }, select: { authzVersion: true } });
    expect(after.authzVersion).toBe(before.authzVersion + 1);
    expect(await isElevatedIdentityContextCurrent(prisma, {
      userId: ids.admin1,
      identity: SEEDED_ROLE_QA_EMAILS.facilityAdmin,
      identityLinkId: ids.admin1Link,
      authenticationMethod: "synthetic_mfa",
      assurance: "synthetic_mfa",
      authenticatedAt: context.authenticatedAt,
    })).toBe(false);
  });
});
