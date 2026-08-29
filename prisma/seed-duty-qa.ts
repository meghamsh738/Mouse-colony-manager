import type { FacilityDuty, Prisma } from "@prisma/client";

export async function seedDutyQaFixture(tx: Prisma.TransactionClient, input: {
  fixturePrefix: string;
  requesterId: string;
  approverId: string;
  grants: Array<{ targetUserId: string; duties: FacilityDuty[] }>;
  syntheticIdentities: Array<{ userId: string; subject: string }>;
}) {
  const identityLinkIds = new Map<string, string>();
  const [databaseClock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`;
  const fixtureTime = databaseClock?.now ?? new Date(0);

  for (const [index, identity] of input.syntheticIdentities.entries()) {
    const linkId = `${input.fixturePrefix}-identity-link-${index + 1}`;
    identityLinkIds.set(identity.userId, linkId);
    await tx.externalIdentityLink.create({
      data: {
        id: linkId,
        userId: identity.userId,
        provider: "synthetic",
        providerSubject: identity.subject.toLowerCase(),
        assurance: "synthetic_mfa",
        linkedById: input.requesterId,
      },
    });
    await tx.externalIdentityLifecycleEvent.create({
      data: {
        id: `${input.fixturePrefix}-identity-event-${index + 1}`,
        identityLinkId: linkId,
        actorId: input.requesterId,
        eventType: "linked",
        assurance: "synthetic_mfa",
        detail: { fixture: true },
      },
    });
  }

  const validFrom = fixtureTime;
  const validUntil = new Date(validFrom.getTime() + 365 * 24 * 60 * 60 * 1_000);
  const grants = input.grants.flatMap(({ targetUserId, duties }) => duties.map((duty) => ({ targetUserId, duty })));

  for (const [index, grant] of grants.entries()) {
    const requestedById = grant.targetUserId === input.requesterId || grant.targetUserId === input.approverId
      ? grant.targetUserId
      : input.requesterId;
    const decidedById = requestedById === input.requesterId ? input.approverId : input.requesterId;
    const [requester, approver, target] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: requestedById }, select: { authzVersion: true } }),
      tx.user.findUniqueOrThrow({ where: { id: decidedById }, select: { authzVersion: true } }),
      tx.user.findUniqueOrThrow({ where: { id: grant.targetUserId }, select: { authzVersion: true } }),
    ]);
    const requestedIdentityLinkId = identityLinkIds.get(requestedById);
    const decidedIdentityLinkId = identityLinkIds.get(decidedById);
    if (!requestedIdentityLinkId || !decidedIdentityLinkId) {
      throw new Error("Duty QA fixture administrators require synthetic identity links.");
    }

    const authenticatedAt = fixtureTime;
    const requestId = `${input.fixturePrefix}-duty-request-${index + 1}`;
    const assignmentId = `${input.fixturePrefix}-duty-assignment-${index + 1}`;
    await tx.facilityDutyRequest.create({
      data: {
        id: requestId,
        requestType: "grant",
        duty: grant.duty,
        targetUserId: grant.targetUserId,
        targetAuthzVersion: target.authzVersion,
        requestedValidFrom: validFrom,
        requestedValidUntil: validUntil,
        reason: `QA fixture for ${grant.duty.replaceAll("_", " ")}.`,
        requestedById,
        requestedByAuthzVersion: requester.authzVersion,
        requestedAssurance: "synthetic_mfa",
        requestedIdentityLinkId,
        requestedAuthenticatedAt: authenticatedAt,
        expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1_000),
      },
    });
    await tx.facilityDutyLifecycleEvent.create({
      data: {
        id: `${input.fixturePrefix}-duty-event-requested-${index + 1}`,
        requestId,
        targetUserId: grant.targetUserId,
        actorId: requestedById,
        eventType: "requested",
        detail: { fixture: true },
      },
    });
    await tx.facilityDutyRequest.update({
      where: { id: requestId },
      data: {
        status: "approved",
        decidedById,
        decidedByAuthzVersion: approver.authzVersion,
        decidedAssurance: "synthetic_mfa",
        decidedIdentityLinkId,
        decidedAuthenticatedAt: authenticatedAt,
        decidedAt: fixtureTime,
        version: { increment: 1 },
      },
    });
    await tx.facilityDutyAssignment.create({
      data: { id: assignmentId, userId: grant.targetUserId, duty: grant.duty, validFrom, validUntil, grantRequestId: requestId },
    });
    await tx.user.update({ where: { id: grant.targetUserId }, data: { authzVersion: { increment: 1 } } });
    await tx.facilityDutyLifecycleEvent.createMany({
      data: [
        { id: `${input.fixturePrefix}-duty-event-approved-${index + 1}`, requestId, assignmentId, targetUserId: grant.targetUserId, actorId: decidedById, eventType: "approved", detail: { fixture: true } },
        { id: `${input.fixturePrefix}-duty-event-activated-${index + 1}`, requestId, assignmentId, targetUserId: grant.targetUserId, actorId: decidedById, eventType: "activated", detail: { fixture: true } },
      ],
    });
  }
}
