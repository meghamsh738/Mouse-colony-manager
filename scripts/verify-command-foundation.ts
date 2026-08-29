import { spawn } from "node:child_process";

import { Prisma, type FacilityIdentifierType } from "@prisma/client";

import { seedDutyQaFixture } from "../prisma/seed-duty-qa";
import { assertRetainedVerificationTarget } from "./retained-verification-guard";

function databaseUrlForSchema(rawUrl: string, schema: string, pooled: boolean) {
  const url = new URL(rawUrl);
  url.searchParams.set("schema", schema);
  if (pooled) url.searchParams.set("pgbouncer", "true");
  else url.searchParams.delete("pgbouncer");
  return url.toString();
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${[command, ...args].join(" ")} failed with ${signal ?? `exit code ${code}`}.`));
    });
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectCheckViolation(
  db: { $executeRawUnsafe(query: string): Promise<number> },
  statement: string,
  failureMessage: string,
) {
  const escapedMessage = failureMessage.replaceAll("'", "''");
  await db.$executeRawUnsafe(`
    DO $verification$
    BEGIN
      BEGIN
        ${statement};
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '${escapedMessage}';
      EXCEPTION WHEN check_violation THEN
        NULL;
      END;
    END $verification$;
  `);
}

async function main() {
  const baseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required for command verification.");
  assertRetainedVerificationTarget(baseUrl);

  const schema = `mcm_test_command_foundation_${Date.now()}_${process.pid}`;
  const directUrl = databaseUrlForSchema(baseUrl, schema, false);
  const runtimeUrl = databaseUrlForSchema(baseUrl, schema, true);
  const env = { ...process.env, DATABASE_URL: runtimeUrl, DIRECT_DATABASE_URL: directUrl };
  await run("npx", ["prisma", "migrate", "deploy"], env);

  process.env.DATABASE_URL = runtimeUrl;
  process.env.DIRECT_DATABASE_URL = directUrl;
  process.env.OUTBOX_WORKER_TOKEN_BILLING_DELIVERY = "command-verification-billing-worker-token-2026";

  const command = await import("../src/lib/command-foundation");
  const billing = await import("../src/lib/billing-write");
  const cageClosure = await import("../src/lib/cage-closure-write");
  const cageIntake = await import("../src/lib/cage-intake-write");
  const colony = await import("../src/lib/colony-write");
  const quarantine = await import("../src/lib/quarantine-write");
  const { getActorCapabilities } = await import("../src/lib/capabilities");
  const { prisma: db } = await import("../src/lib/prisma");

  try {
    await db.user.create({
      data: {
        id: "command-admin",
        name: "Command Verification Admin",
        email: "command-admin@example.test",
        passwordHash: "not-a-login-hash",
        role: "facility_admin",
      },
    });
    await db.lab.create({ data: { id: "command-lab", name: "Command Lab", code: "CMD" } });
    await db.lab.create({ data: { id: "command-lab-b", name: "Command Lab B", code: "CMD-B" } });
    await db.strain.create({ data: { id: "command-strain", name: "Command strain" } });
    await db.facility.create({
      data: { id: "command-facility", name: "Command Facility", cageBarcodePrefix: "CMD", maxCageOccupancy: 6 },
    });
    await db.room.create({ data: { id: "command-room", facilityId: "command-facility", roomNumber: "R1" } });
    await db.rack.create({ data: { id: "command-rack", roomId: "command-room", rackNumber: "A" } });
    await db.cageChargeCategory.create({
      data: { id: "command-standard", name: "Standard", code: "STANDARD", dailyRateCents: 100 },
    });

    await db.user.create({
      data: {
        id: "command-compliance-reviewer",
        name: "Command Compliance Reviewer",
        email: "command-compliance-reviewer@example.test",
        passwordHash: "not-a-login-hash",
        role: "facility_admin",
      },
    });
    await db.labMembership.create({
      data: {
        id: "command-admin-membership",
        labId: "command-lab",
        userId: "command-admin",
        role: "owner",
      },
    });

    const complianceIdentityLinkId = "command-compliance-identity-link-1";
    const complianceProtocolId = "command-compliance-protocol";
    const complianceProtocolVersionId = `${complianceProtocolId}-v1`;
    const complianceReviewerId = "command-compliance-reviewer";
    await db.$transaction(async (tx) => {
      const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`;
      const validFrom = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
      const validUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000);
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await seedDutyQaFixture(tx, {
        fixturePrefix: "command-compliance",
        requesterId: "command-admin",
        approverId: complianceReviewerId,
        grants: [{
          targetUserId: complianceReviewerId,
          duties: ["protocol_reviewer", "training_administrator"],
        }],
        syntheticIdentities: [
          { userId: "command-admin", subject: "command-admin@example.test" },
          { userId: complianceReviewerId, subject: "command-compliance-reviewer@example.test" },
        ],
      });

      const [creator, reviewer] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: "command-admin" }, select: { authzVersion: true } }),
        tx.user.findUniqueOrThrow({ where: { id: complianceReviewerId }, select: { authzVersion: true } }),
      ]);
      const createFixtureReceipt = async (input: {
        id: string;
        actorId: string;
        actorAuthzVersion: number;
        commandType: string;
        aggregateType: string;
        aggregateId: string;
      }) => tx.commandReceipt.create({
        data: {
          ...input,
          labId: "command-lab",
          idempotencyKey: input.id,
          requestHash: command.canonicalJsonHash({ fixture: input.id }),
          requestId: input.id,
          status: "succeeded",
          result: { fixture: "command-foundation-compliance" },
          completedAt: now,
        },
      });

      const creationReceiptId = `${complianceProtocolId}-draft-receipt`;
      const activationReceiptId = `${complianceProtocolId}-activate-receipt`;
      await createFixtureReceipt({
        id: creationReceiptId,
        actorId: "command-admin",
        actorAuthzVersion: creator.authzVersion,
        commandType: "protocol_authorization.draft.create",
        aggregateType: "protocol_authorization",
        aggregateId: complianceProtocolId,
      });
      await createFixtureReceipt({
        id: activationReceiptId,
        actorId: complianceReviewerId,
        actorAuthzVersion: reviewer.authzVersion,
        commandType: "protocol_authorization.activate",
        aggregateType: "protocol_authorization",
        aggregateId: complianceProtocolId,
      });
      const protocolContent = {
        labId: "command-lab",
        protocolCode: "CMD-SYNTHETIC",
        title: "Synthetic command-foundation authorization",
        summary: "Synthetic protocol for retained disposable command verification.",
        validFrom: validFrom.toISOString(),
        validUntil: validUntil.toISOString(),
        approvedAnimalCount: 50,
        projectIds: [],
        experimentIds: [],
        strainIds: ["command-strain"],
        procedureCodes: ["breeding"],
        personnel: [{ userId: "command-admin", roleLabel: "breeding_operator" as const }],
        policyVersion: "synthetic-fail-closed-v1",
      };
      await tx.protocolAuthorization.create({
        data: {
          id: complianceProtocolId,
          labId: "command-lab",
          protocolCode: protocolContent.protocolCode,
          title: protocolContent.title,
          status: "draft",
          createdById: "command-admin",
        },
      });
      await tx.protocolAuthorizationVersion.create({
        data: {
          id: complianceProtocolVersionId,
          authorizationId: complianceProtocolId,
          versionNumber: 1,
          contentHash: command.canonicalJsonHash(protocolContent),
          contentPayload: command.canonicalJson(protocolContent),
          policyVersion: protocolContent.policyVersion,
          validFrom,
          validUntil,
          approvedAnimalCount: protocolContent.approvedAnimalCount,
          summary: protocolContent.summary,
          createdById: "command-admin",
          creationCommandReceiptId: creationReceiptId,
          scopeSealedAt: now,
        },
      });
      await Promise.all([
        tx.protocolStrainBinding.create({
          data: {
            id: `${complianceProtocolVersionId}-strain`,
            authorizationVersionId: complianceProtocolVersionId,
            labId: "command-lab",
            strainId: "command-strain",
          },
        }),
        tx.protocolProcedureBinding.create({
          data: {
            id: `${complianceProtocolVersionId}-procedure`,
            authorizationVersionId: complianceProtocolVersionId,
            labId: "command-lab",
            procedureCode: "breeding",
          },
        }),
        tx.protocolPersonnelBinding.create({
          data: {
            id: `${complianceProtocolVersionId}-person`,
            authorizationVersionId: complianceProtocolVersionId,
            labId: "command-lab",
            userId: "command-admin",
            roleLabel: "breeding_operator",
          },
        }),
        tx.protocolCountLedger.create({
          data: {
            id: `${complianceProtocolVersionId}-ledger`,
            authorizationVersionId: complianceProtocolVersionId,
            approvedCount: protocolContent.approvedAnimalCount,
          },
        }),
      ]);
      await tx.protocolAuthorization.update({
        where: { id: complianceProtocolId },
        data: {
          currentVersionId: complianceProtocolVersionId,
          status: "active",
          reviewedById: complianceReviewerId,
          reviewedByAuthzVersion: reviewer.authzVersion,
          reviewedAssurance: "synthetic_mfa",
          reviewedIdentityLinkId: "command-compliance-identity-link-2",
          reviewedAuthenticatedAt: now,
          reviewedDutyAssignmentId: "command-compliance-duty-assignment-1",
          reviewedDutyAssignmentVersion: 1,
          reviewedAt: now,
          activatedAt: now,
          statusReason: "Approved synthetic command verification fixture.",
          version: 2,
        },
      });
      await tx.protocolAuthorizationLifecycleEvent.create({
        data: {
          id: `${complianceProtocolId}-activate-event`,
          authorizationId: complianceProtocolId,
          fromStatus: "draft",
          toStatus: "active",
          actorId: complianceReviewerId,
          actorAuthzVersion: reviewer.authzVersion,
          assurance: "synthetic_mfa",
          identityLinkId: "command-compliance-identity-link-2",
          authenticatedAt: now,
          dutyAssignmentId: "command-compliance-duty-assignment-1",
          dutyAssignmentVersion: 1,
          commandReceiptId: activationReceiptId,
          reason: "Approved synthetic command verification fixture.",
          occurredAt: now,
        },
      });

      const competencyId = "command-breeding-competency";
      const competencyVersionId = `${competencyId}-v1`;
      const competencyReceiptId = `${competencyId}-receipt`;
      const competencyNote = "Current synthetic breeding competency for retained verification.";
      const competencyContent = {
        userId: "command-admin",
        labId: "command-lab",
        procedureCode: "breeding",
        evidenceType: "synthetic_training_record",
        validFrom: validFrom.toISOString(),
        validUntil: validUntil.toISOString(),
        protocolVersionId: null,
        note: competencyNote,
        versionNumber: 1,
      };
      await createFixtureReceipt({
        id: competencyReceiptId,
        actorId: complianceReviewerId,
        actorAuthzVersion: reviewer.authzVersion,
        commandType: "competency_evidence.create",
        aggregateType: "competency_evidence",
        aggregateId: competencyId,
      });
      await tx.competencyEvidence.create({
        data: {
          id: competencyId,
          userId: "command-admin",
          labId: "command-lab",
          procedureCode: "breeding",
          status: "current",
          governedById: complianceReviewerId,
          governedByAuthzVersion: reviewer.authzVersion,
          governedAssurance: "synthetic_mfa",
          governedIdentityLinkId: "command-compliance-identity-link-2",
          governedAuthenticatedAt: now,
          governedDutyAssignmentId: "command-compliance-duty-assignment-2",
          governedDutyAssignmentVersion: 1,
          governedAt: now,
        },
      });
      await tx.competencyEvidenceVersion.create({
        data: {
          id: competencyVersionId,
          evidenceId: competencyId,
          versionNumber: 1,
          evidenceType: competencyContent.evidenceType,
          contentHash: command.canonicalJsonHash(competencyContent),
          contentPayload: command.canonicalJson(competencyContent),
          validFrom,
          validUntil,
          issuedById: complianceReviewerId,
          commandReceiptId: competencyReceiptId,
          note: competencyNote,
        },
      });
      await tx.competencyEvidence.update({
        where: { id: competencyId },
        data: { currentVersionId: competencyVersionId },
      });
      await tx.competencyLifecycleEvent.create({
        data: {
          id: `${competencyId}-event`,
          evidenceId: competencyId,
          actorId: complianceReviewerId,
          actorAuthzVersion: reviewer.authzVersion,
          assurance: "synthetic_mfa",
          identityLinkId: "command-compliance-identity-link-2",
          authenticatedAt: now,
          dutyAssignmentId: "command-compliance-duty-assignment-2",
          dutyAssignmentVersion: 1,
          commandReceiptId: competencyReceiptId,
          eventType: "created",
          evidenceVersion: 1,
          detail: { fixture: "command-foundation-compliance" },
          occurredAt: now,
        },
      });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });

    const capabilities = [...getActorCapabilities({ canonicalRole: "facility_admin", activeMembership: null })];
    const actor = {
      id: "command-admin",
      email: "command-admin@example.test",
      name: "Command Verification Admin",
      role: "admin" as const,
      databaseRole: "facility_admin" as const,
      canonicalRole: "facility_admin" as const,
      authzVersion: 1,
      authMethod: "synthetic_mfa" as const,
      assurance: "synthetic_mfa" as const,
      authenticatedAt: new Date().toISOString(),
      identityLinkId: complianceIdentityLinkId,
      activeLabId: null,
      activeMembership: null,
      memberships: [],
      capabilities,
    };
    const billingWorker = command.authenticateOutboxWorker({
      workerId: "worker-1",
      workerType: "billing_delivery",
      token: process.env.OUTBOX_WORKER_TOKEN_BILLING_DELIVERY,
    });
    const backupBillingWorker = command.authenticateOutboxWorker({
      workerId: "worker-2",
      workerType: "billing_delivery",
      token: process.env.OUTBOX_WORKER_TOKEN_BILLING_DELIVERY,
    });
    assert(billingWorker && backupBillingWorker, "Outbox worker authentication failed.");

    const [facilityAnimalId] = await db.$transaction(async (tx) => {
      const ids = await command.allocateFacilityIdentifiers(tx, "animal", 1);
      await tx.animal.create({
        data: {
          id: "command-animal",
          facilityAnimalId: ids[0],
          animalId: "LEGACY-COLONY-1",
          labId: "LEGACY-LAB-1",
          owningLabId: "command-lab",
          sex: "female",
          dob: new Date("2026-01-01T00:00:00.000Z"),
          strainId: "command-strain",
          status: "colony_holding",
          originType: "verification",
        },
      });
      return ids;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    assert(facilityAnimalId === "0001", `Expected first animal ID 0001, received ${facilityAnimalId}.`);

    const assignment = await db.facilityIdentifierAssignment.findUnique({
      where: { entityType_entityId: { entityType: "animal", entityId: "command-animal" } },
    });
    assert(assignment?.displayId === "0001", "Canonical animal assignment was not recorded.");
    const aliases = await db.legacyIdentifierAlias.findMany({ where: { entityType: "animal", entityId: "command-animal" } });
    assert(aliases.some((alias) => alias.alias === "LEGACY-COLONY-1"), "Animal colony alias was not retained.");
    assert(aliases.some((alias) => alias.alias === "LEGACY-LAB-1"), "Animal lab alias was not retained.");

    await db.legacyIdentifierAlias.create({
      data: {
        id: "numeric-alias-reservation",
        entityType: "animal",
        entityId: "command-animal",
        alias: "0003",
        canonicalDisplayId: "0001",
        source: "verification",
      },
    });
    const skippedNumericAlias = await db.$transaction(async (tx) => {
      const ids = await command.allocateFacilityIdentifiers(tx, "animal", 2);
      await tx.animal.createMany({
        data: ids.map((id, index) => ({
          id: `command-animal-skip-${index}`,
          facilityAnimalId: id,
          animalId: `SKIP-COLONY-${index}`,
          labId: `SKIP-LAB-${index}`,
          owningLabId: "command-lab",
          sex: "unknown" as const,
          dob: new Date("2026-01-01T00:00:00.000Z"),
          strainId: "command-strain",
          status: "colony_holding" as const,
          originType: "verification",
        })),
      });
      return ids;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    assert(skippedNumericAlias.join(",") === "0002,0004", `Numeric legacy alias was not reserved: ${skippedNumericAlias.join(",")}.`);

    const updatedAnimal = await db.animal.update({
      where: { id: "command-animal" },
      data: { notes: "version trigger verification" },
      select: { version: true },
    });
    assert(updatedAnimal.version === 2, `Expected aggregate version 2, received ${updatedAnimal.version}.`);
    await expectCheckViolation(
      db,
      `UPDATE "Animal" SET "facilityAnimalId" = '0002' WHERE id = 'command-animal'`,
      "Canonical animal ID mutation was not rejected.",
    );

    const draftResult = await command.createWorkflowDraft({
      actor,
      workflowType: "animal_intake",
      labId: "command-lab",
      payload: { source: "verification", animals: 1 },
    });
    assert(draftResult.ok, "Workflow draft creation failed.");
    const snapshotResult = await command.createWorkflowReviewSnapshot({
      actor,
      draftId: draftResult.draft.id,
      expectedVersion: 1,
    });
    assert(snapshotResult.ok, "Workflow review snapshot creation failed.");
    assert(snapshotResult.snapshot.payloadHash === command.canonicalJsonHash({ animals: 1, source: "verification" }), "Snapshot hash is not canonical.");
    await expectCheckViolation(
      db,
      `UPDATE "WorkflowReviewSnapshot" SET "payloadHash" = 'mutated' WHERE id = '${snapshotResult.snapshot.id}'`,
      "Review snapshot mutation was not rejected.",
    );

    const intakeCommand = {
      mode: "new" as const,
      payload: {
        cages: [{
          clientId: "cage-001",
          labId: "command-lab",
          roomId: "command-room",
          rackId: "command-rack",
          cageNumber: "001",
          status: "active" as const,
          chargeCategoryId: "command-standard",
          startDate: "2026-07-12",
        }],
        assignments: [],
        movedAt: "2026-07-12",
        reason: "Command verification intake",
      },
    };
    const intakeEnvelope = {
      schemaVersion: 1 as const,
      mode: "new" as const,
      step: 3 as const,
      labId: "command-lab",
      operationDate: "2026-07-12",
      reason: "Command verification intake",
      selectedAnimalIds: [],
      femaleCount: 0,
      maleCount: 0,
      weanStrainId: "",
      vendor: "",
      orderReference: "",
      disposition: "holding" as const,
      intakeNotes: "",
      purchaseRows: [],
      subjects: [],
      cages: intakeCommand.payload.cages,
      assignments: {},
      command: intakeCommand,
    };
    const intakeReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-intake-draft",
      workflowType: "cage_intake.new",
      requiredCapability: "cages:manage",
      labId: "command-lab",
      payload: intakeEnvelope,
    });
    assert(intakeReview.ok, "Cage intake review preparation failed.");
    const intakeResult = await cageIntake.executeCageIntakeCommand({
      actor,
      command: intakeCommand,
      idempotencyKey: intakeReview.snapshot.id,
      requestId: intakeReview.snapshot.id,
      workflowDraftId: intakeReview.draft.id,
      reviewSnapshotId: intakeReview.snapshot.id,
    });
    assert(intakeResult.ok && !intakeResult.replayed, "Reviewed cage intake did not commit.");
    const committedDraft = await db.workflowDraft.findUniqueOrThrow({ where: { id: intakeReview.draft.id } });
    assert(committedDraft.status === "committed", "Cage intake draft was not committed atomically.");
    const intakeReplay = await cageIntake.executeCageIntakeCommand({
      actor,
      command: intakeCommand,
      idempotencyKey: intakeReview.snapshot.id,
      requestId: "command-intake-replay",
      workflowDraftId: intakeReview.draft.id,
      reviewSnapshotId: intakeReview.snapshot.id,
    });
    assert(intakeReplay.ok && intakeReplay.replayed, "Reviewed cage intake did not replay safely.");
    assert(await db.cage.count({ where: { barcode: "CMD-R1-A-001" } }) === 1, "Cage intake replay created a duplicate cage.");

    const staleCommand = {
      ...intakeCommand,
      payload: {
        ...intakeCommand.payload,
        cages: intakeCommand.payload.cages.map((cage) => ({ ...cage, clientId: "cage-002", cageNumber: "002" })),
      },
    };
    const staleEnvelope = { ...intakeEnvelope, cages: staleCommand.payload.cages, command: staleCommand };
    const staleReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-intake-stale-draft",
      workflowType: "cage_intake.new",
      requiredCapability: "cages:manage",
      labId: "command-lab",
      payload: staleEnvelope,
    });
    assert(staleReview.ok, "Stale cage intake review preparation failed.");
    const revisedEnvelope = { ...staleEnvelope, reason: "Revised after review" };
    const revisedDraft = await command.upsertWorkflowDraft({
      actor,
      draftId: staleReview.draft.id,
      workflowType: "cage_intake.new",
      requiredCapability: "cages:manage",
      labId: "command-lab",
      expectedVersion: staleReview.draft.version,
      payload: revisedEnvelope,
    });
    assert(revisedDraft.ok, "Reviewed draft could not be revised for stale-snapshot verification.");
    const staleResult = await cageIntake.executeCageIntakeCommand({
      actor,
      command: staleCommand,
      idempotencyKey: staleReview.snapshot.id,
      requestId: staleReview.snapshot.id,
      workflowDraftId: staleReview.draft.id,
      reviewSnapshotId: staleReview.snapshot.id,
    });
    assert(!staleResult.ok, "A stale cage intake review was accepted.");
    assert(await db.cage.count({ where: { barcode: "CMD-R1-A-002" } }) === 0, "A stale cage intake review wrote a cage.");

    const invalidCommand = {
      ...intakeCommand,
      payload: {
        ...intakeCommand.payload,
        cages: intakeCommand.payload.cages.map((cage) => ({ ...cage, clientId: "cage-004", cageNumber: "004" })),
        reason: "x",
      },
    };
    const invalidEnvelope = { ...intakeEnvelope, cages: invalidCommand.payload.cages, reason: "x", command: invalidCommand };
    const invalidReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-intake-invalid-draft",
      workflowType: "cage_intake.new",
      requiredCapability: "cages:manage",
      labId: "command-lab",
      payload: invalidEnvelope,
    });
    assert(invalidReview.ok, "Invalid intake review preparation failed.");
    const invalidResult = await cageIntake.executeCageIntakeCommand({
      actor,
      command: invalidCommand,
      idempotencyKey: invalidReview.snapshot.id,
      requestId: invalidReview.snapshot.id,
      workflowDraftId: invalidReview.draft.id,
      reviewSnapshotId: invalidReview.snapshot.id,
    });
    assert(
      !invalidResult.ok && invalidResult.code === "validation_error",
      `Invalid intake did not return validation failure: ${JSON.stringify(invalidResult)}.`,
    );
    const restoredDraft = await db.workflowDraft.findUniqueOrThrow({ where: { id: invalidReview.draft.id } });
    assert(restoredDraft.status === "review", "Failed intake did not restore its reviewed draft.");

    const commandBreedingCage = await db.cage.findUniqueOrThrow({ where: { barcode: "CMD-R1-A-001" } });
    const breedingAnimalIds = await db.$transaction(async (tx) => {
      const ids = await command.allocateFacilityIdentifiers(tx, "animal", 2);
      await tx.animal.createMany({
        data: [
          {
            id: "command-breeding-sire-animal",
            facilityAnimalId: ids[0],
            animalId: "CMD-BREED-SIRE",
            labId: "CMD-BREED-SIRE-LAB",
            owningLabId: "command-lab",
            sex: "male",
            dob: new Date("2025-12-01T00:00:00.000Z"),
            strainId: "command-strain",
            currentCageId: commandBreedingCage.id,
            status: "breeding",
            originType: "verification",
          },
          {
            id: "command-breeding-dam-animal",
            facilityAnimalId: ids[1],
            animalId: "CMD-BREED-DAM",
            labId: "CMD-BREED-DAM-LAB",
            owningLabId: "command-lab",
            sex: "female",
            dob: new Date("2025-12-01T00:00:00.000Z"),
            strainId: "command-strain",
            currentCageId: commandBreedingCage.id,
            status: "breeding",
            originType: "verification",
          },
        ],
      });
      await tx.cage.update({ where: { id: commandBreedingCage.id }, data: { status: "breeding" } });
      return ids;
    });
    assert(breedingAnimalIds.length === 2, "Breeding verification animals were not allocated.");

    await db.breedingSetup.create({
      data: {
        id: "command-breeding",
        labId: "command-lab",
        protocolAuthorizationId: complianceProtocolId,
        startDate: new Date("2026-06-01T00:00:00.000Z"),
        status: "active",
        targetGenotype: "verification target",
        adults: {
          create: [
            { id: "command-breeding-sire", animalId: "command-breeding-sire-animal", role: "sire" },
            { id: "command-breeding-dam", animalId: "command-breeding-dam-animal", role: "dam" },
          ],
        },
      },
    });
    const staleBreedingCage = await db.$transaction(async (tx) => {
      const [facilityCageId] = await command.allocateFacilityIdentifiers(tx, "cage", 1);
      return tx.cage.create({
        data: {
          id: "command-stale-breeding-cage",
          facilityCageId,
          labId: "command-lab",
          roomId: "command-room",
          rackId: "command-rack",
          cageNumber: "003",
          barcode: "CMD-R1-A-003",
          status: "breeding",
        },
      });
    });
    const litterCommand = {
      breedingSetupId: "command-breeding",
      birthDate: "2026-07-01",
      litterSizeBirth: 5,
      notes: "Versioned litter verification",
    };
    const litterResult = await colony.executeRecordBreedingLitterCommand({
      actor,
      command: litterCommand,
      expectedVersion: 1,
      idempotencyKey: "command-litter-first",
      requestId: "command-litter-first",
    });
    assert(litterResult.ok, "Versioned litter command failed.");
    const advancedSetup = await db.breedingSetup.findUniqueOrThrow({ where: { id: "command-breeding" } });
    assert(advancedSetup.version === 2, `Litter creation did not advance breeding version: ${advancedSetup.version}.`);
    const staleLitterResult = await colony.executeRecordBreedingLitterCommand({
      actor,
      command: { ...litterCommand, birthDate: "2026-07-02" },
      expectedVersion: 1,
      idempotencyKey: "command-litter-stale",
      requestId: "command-litter-stale",
    });
    assert(!staleLitterResult.ok && staleLitterResult.code === "stale_conflict", "Stale litter creation was not rejected.");
    assert(await db.litter.count({ where: { breedingSetupId: "command-breeding" } }) === 1, "Stale litter command created a second litter.");
    const futureLitterDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const futureLitter = await colony.executeRecordBreedingLitterCommand({
      actor,
      command: { ...litterCommand, birthDate: futureLitterDate },
      expectedVersion: 2,
      idempotencyKey: "command-litter-future",
      requestId: "command-litter-future",
    });
    assert(!futureLitter.ok && futureLitter.code === "validation_error", "Future litter date was not rejected.");
    const blockedBreederLifecycle = await colony.updateAnimalLifecycleStatus({
      animalId: "command-breeding-sire-animal",
      targetStatus: "dead",
      happenedAt: "2026-07-10",
      reason: "Open breeding lifecycle removal must fail",
    }, actor);
    assert(!blockedBreederLifecycle.ok, "Terminal lifecycle update removed an adult from an open breeding setup.");
    const retainedBreeder = await db.animal.findUniqueOrThrow({ where: { id: "command-breeding-sire-animal" } });
    assert(retainedBreeder.outcomeStatus === "alive" && retainedBreeder.currentCageId === commandBreedingCage.id, "Blocked lifecycle update changed the breeder.");

    const beforeLitterTransition = await colony.executeTransitionBreedingSetupCommand({
      actor,
      command: {
        breedingSetupId: "command-breeding",
        targetStatus: "paused",
        happenedAt: "2026-06-30",
        reason: "Backdated transition must fail",
      },
      expectedVersion: 2,
      idempotencyKey: "command-breeding-before-litter",
      requestId: "command-breeding-before-litter",
    });
    assert(
      !beforeLitterTransition.ok && beforeLitterTransition.code === "validation_error",
      "Transition before the latest litter was not rejected.",
    );
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const futureTransition = await colony.executeTransitionBreedingSetupCommand({
      actor,
      command: {
        breedingSetupId: "command-breeding",
        targetStatus: "paused",
        happenedAt: tomorrow,
        reason: "Future transition must fail",
      },
      expectedVersion: 2,
      idempotencyKey: "command-breeding-future",
      requestId: "command-breeding-future",
    });
    assert(!futureTransition.ok && futureTransition.code === "validation_error", "Future breeding transition was not rejected.");

    const pauseCommand = {
      breedingSetupId: "command-breeding",
      targetStatus: "paused" as const,
      happenedAt: "2026-07-10",
      reason: "Pause for retained command verification",
    };
    const paused = await colony.executeTransitionBreedingSetupCommand({
      actor,
      command: pauseCommand,
      expectedVersion: 2,
      idempotencyKey: "command-breeding-pause",
      requestId: "command-breeding-pause",
    });
    assert(paused.ok && !paused.replayed, `Breeding pause command failed: ${JSON.stringify(paused)}.`);
    assert((await db.breedingSetup.findUniqueOrThrow({ where: { id: "command-breeding" } })).version === 3, "Breeding pause did not advance version.");
    const pauseReplay = await colony.executeTransitionBreedingSetupCommand({
      actor,
      command: pauseCommand,
      expectedVersion: 2,
      idempotencyKey: "command-breeding-pause",
      requestId: "command-breeding-pause-replay",
    });
    assert(pauseReplay.ok && pauseReplay.replayed, "Breeding pause did not replay idempotently.");
    const blockedBreederMove = await colony.moveAnimalToCage({
      animalId: "command-breeding-dam-animal",
      toCageId: staleBreedingCage.id,
      movedAt: "2026-07-10",
      reason: "Routine breeder movement must fail",
    }, actor);
    assert(!blockedBreederMove.ok, "Routine movement allowed an animal in an open breeding setup.");
    await db.animal.update({
      where: { id: "command-breeding-dam-animal" },
      data: { currentCageId: staleBreedingCage.id },
    });
    const splitCageResume = await colony.executeTransitionBreedingSetupCommand({
      actor,
      command: {
        breedingSetupId: "command-breeding",
        targetStatus: "active",
        happenedAt: "2026-07-11",
        reason: "Split cage resume must fail",
      },
      expectedVersion: 3,
      idempotencyKey: "command-breeding-resume-split",
      requestId: "command-breeding-resume-split",
    });
    assert(!splitCageResume.ok && splitCageResume.code === "validation_error", "Split-cage breeding setup resumed unexpectedly.");
    await db.animal.update({
      where: { id: "command-breeding-dam-animal" },
      data: { currentCageId: commandBreedingCage.id },
    });
    const staleResume = await colony.executeTransitionBreedingSetupCommand({
      actor,
      command: {
        breedingSetupId: "command-breeding",
        targetStatus: "active",
        happenedAt: "2026-07-11",
        reason: "Stale resume verification",
      },
      expectedVersion: 2,
      idempotencyKey: "command-breeding-resume-stale",
      requestId: "command-breeding-resume-stale",
    });
    assert(!staleResume.ok && staleResume.code === "stale_conflict", "Stale breeding resume was not rejected.");
    const resumed = await colony.executeTransitionBreedingSetupCommand({
      actor,
      command: {
        breedingSetupId: "command-breeding",
        targetStatus: "active",
        happenedAt: "2026-07-11",
        reason: "Resume retained command verification",
      },
      expectedVersion: 3,
      idempotencyKey: "command-breeding-resume",
      requestId: "command-breeding-resume",
    });
    assert(resumed.ok, "Breeding resume command failed.");
    const retired = await colony.executeTransitionBreedingSetupCommand({
      actor,
      command: {
        breedingSetupId: "command-breeding",
        targetStatus: "retired",
        happenedAt: "2026-07-12",
        reason: "Retire retained command verification",
      },
      expectedVersion: 4,
      idempotencyKey: "command-breeding-retire",
      requestId: "command-breeding-retire",
    });
    assert(retired.ok, "Breeding retirement command failed.");
    const retiredSetup = await db.breedingSetup.findUniqueOrThrow({ where: { id: "command-breeding" } });
    assert(retiredSetup.status === "retired" && retiredSetup.version === 5 && retiredSetup.endDate, "Breeding retirement state was incomplete.");
    const releasedAnimals = await db.animal.findMany({
      where: { id: { in: ["command-breeding-sire-animal", "command-breeding-dam-animal"] } },
      select: { status: true },
    });
    assert(releasedAnimals.every((animal) => animal.status === "colony_holding"), "Retired breeding parents were not released.");
    assert((await db.cage.findUniqueOrThrow({ where: { id: commandBreedingCage.id } })).status === "active", "Retired breeding cage was not released.");
    assert((await db.cage.findUniqueOrThrow({ where: { id: staleBreedingCage.id } })).status === "active", "Stale breeding cage was not reconciled.");
    const transitionAudit = await db.auditLog.findFirstOrThrow({
      where: { entityType: "breeding_setup", entityId: "command-breeding", action: "transition_status" },
      orderBy: { timestamp: "desc" },
    });
    assert(
      transitionAudit.timestamp.getTime() > new Date("2026-07-12T00:00:00.000Z").getTime(),
      "Breeding audit timestamp used the business-effective date instead of transaction time.",
    );
    assert(
      await db.auditLog.count({ where: { entityType: "cage", action: "reconcile_breeding_status" } }) >= 2,
      "Breeding cage status changes were not audited.",
    );
    const terminalResume = await colony.executeTransitionBreedingSetupCommand({
      actor,
      command: {
        breedingSetupId: "command-breeding",
        targetStatus: "active",
        happenedAt: "2026-07-12",
        reason: "Terminal resume must fail",
      },
      expectedVersion: 5,
      idempotencyKey: "command-breeding-terminal-resume",
      requestId: "command-breeding-terminal-resume",
    });
    assert(!terminalResume.ok && terminalResume.code === "validation_error", "Terminal breeding setup resumed unexpectedly.");

    const competingCreateCommand = {
      sireId: "command-breeding-sire-animal",
      damId: "command-breeding-dam-animal",
      protocolAuthorizationId: complianceProtocolId,
      startDate: "2026-07-12",
      targetGenotype: "Concurrent command verification",
      targetSex: "unknown" as const,
      notes: "Only one competing command may create an open setup.",
    };
    const competingCreateOperations = [
      () => colony.executeCreateBreedingSetupCommand({
        actor,
        command: competingCreateCommand,
        idempotencyKey: "command-breeding-create-race-a",
        requestId: "command-breeding-create-race-a",
      }),
      () => colony.executeCreateBreedingSetupCommand({
        actor,
        command: competingCreateCommand,
        idempotencyKey: "command-breeding-create-race-b",
        requestId: "command-breeding-create-race-b",
      }),
    ];
    let competingCreates = await Promise.all(competingCreateOperations.map((operation) => operation()));
    for (let attempt = 0; attempt < 5 && competingCreates.some((result) => !result.ok && result.code === "unexpected_error"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await db.$disconnect();
      await db.$connect();
      competingCreates = await Promise.all(competingCreates.map((result, index) =>
        !result.ok && result.code === "unexpected_error" ? competingCreateOperations[index]() : result));
    }
    assert(competingCreates.filter((result) => result.ok).length === 1, `Competing setup creation did not produce exactly one winner: ${JSON.stringify(competingCreates)}.`);
    assert(await db.breedingSetup.count({
      where: {
        status: { in: ["planned", "active", "paused"] },
        adults: { some: { animalId: "command-breeding-sire-animal" } },
      },
    }) === 1, "Concurrent setup creation left multiple open relationships for one breeder.");

    await db.user.update({ where: { id: actor.id }, data: { active: false, authzVersion: { increment: 1 } } });
    const revokedCreation = await colony.executeCreateBreedingSetupCommand({
      actor,
      command: { ...competingCreateCommand, targetGenotype: "Revoked command must fail" },
      idempotencyKey: "command-breeding-create-revoked",
      requestId: "command-breeding-create-revoked",
    });
    assert(!revokedCreation.ok && revokedCreation.code === "forbidden", "Revoked actor created a breeding setup.");
    await db.user.update({ where: { id: actor.id }, data: { active: true, authzVersion: actor.authzVersion } });

    await db.project.create({
      data: {
        id: "command-lifecycle-project",
        labId: "command-lab",
        projectCode: "CMD-LIFECYCLE",
        title: "Lifecycle command verification",
        ownerId: actor.id,
      },
    });
    const lifecycleIds = await db.$transaction(async (tx) => {
      const ids = await command.allocateFacilityIdentifiers(tx, "animal", 2);
      await tx.animal.createMany({
        data: [
          {
            id: "command-lifecycle-animal",
            facilityAnimalId: ids[0],
            animalId: "CMD-LIFECYCLE-1",
            labId: "CMD-LIFECYCLE-LAB-1",
            owningLabId: "command-lab",
            sex: "female",
            dob: new Date("2026-01-01T00:00:00.000Z"),
            strainId: "command-strain",
            currentCageId: staleBreedingCage.id,
            status: "colony_holding",
            originType: "verification",
          },
          {
            id: "command-experiment-block-animal",
            facilityAnimalId: ids[1],
            animalId: "CMD-LIFECYCLE-2",
            labId: "CMD-LIFECYCLE-LAB-2",
            owningLabId: "command-lab",
            sex: "male",
            dob: new Date("2026-01-01T00:00:00.000Z"),
            strainId: "command-strain",
            currentCageId: staleBreedingCage.id,
            status: "colony_holding",
            originType: "verification",
          },
        ],
      });
      await tx.animalMovement.createMany({
        data: [
          {
            id: "command-lifecycle-initial-move",
            animalId: "command-lifecycle-animal",
            fromCageId: null,
            toCageId: staleBreedingCage.id,
            movedById: actor.id,
            movedAt: new Date("2026-07-11T12:00:00.000Z"),
            reason: "Initial lifecycle verification assignment",
          },
          {
            id: "command-experiment-block-initial-move",
            animalId: "command-experiment-block-animal",
            fromCageId: null,
            toCageId: staleBreedingCage.id,
            movedById: actor.id,
            movedAt: new Date("2026-07-01T00:00:00.000Z"),
            reason: "Initial experiment-block verification assignment",
          },
        ],
      });
      await tx.animalProjectAllocation.create({
        data: {
          id: "command-lifecycle-allocation",
          animalId: "command-lifecycle-animal",
          projectId: "command-lifecycle-project",
          startedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      });
      await tx.animalProjectAllocation.create({
        data: {
          id: "command-lifecycle-backdate-allocation",
          animalId: "command-experiment-block-animal",
          projectId: "command-lifecycle-project",
          startedAt: new Date("2026-07-10T00:00:00.000Z"),
        },
      });
      return ids;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    assert(lifecycleIds.length === 2, "Lifecycle verification animals did not receive canonical IDs.");

    const lifecycleBefore = await db.animal.findUniqueOrThrow({
      where: { id: "command-lifecycle-animal" },
      select: { version: true },
    });
    const lifecycleCommand = {
      animalId: "command-lifecycle-animal",
      targetStatus: "transferred_out" as const,
      happenedAt: "2026-07-11",
      reason: "Transferred to the external verification facility.",
      destination: "External Verification Facility",
      transferReference: "EXT-CMD-001",
    };
    const lifecycleReviewPayload = { command: lifecycleCommand, expectedVersion: lifecycleBefore.version };
    const lifecycleReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-lifecycle-draft",
      workflowType: "animal.lifecycle",
      requiredCapability: "animals:manage",
      payload: lifecycleReviewPayload,
    });
    assert(lifecycleReview.ok, "Lifecycle review preparation failed.");
    const lifecycleResult = await colony.executeUpdateAnimalLifecycleCommand({
      actor,
      command: lifecycleCommand,
      expectedVersion: lifecycleBefore.version,
      idempotencyKey: "command-lifecycle-transfer-key",
      requestId: lifecycleReview.snapshot.id,
      workflowDraftId: lifecycleReview.draft.id,
      reviewSnapshotId: lifecycleReview.snapshot.id,
    });
    assert(lifecycleResult.ok && !lifecycleResult.replayed, `Reviewed lifecycle command failed: ${JSON.stringify(lifecycleResult)}.`);
    const lifecycleAfter = await db.animal.findUniqueOrThrow({
      where: { id: "command-lifecycle-animal" },
      select: { version: true, status: true, outcomeStatus: true, currentCageId: true },
    });
    assert(lifecycleAfter.version > lifecycleBefore.version, "Lifecycle command did not advance the animal version.");
    assert(
      lifecycleAfter.status === "transferred_out" && lifecycleAfter.outcomeStatus === "transferred" && lifecycleAfter.currentCageId === null,
      "External transfer did not produce the terminal animal state.",
    );
    assert(
      (await db.workflowDraft.findUniqueOrThrow({ where: { id: lifecycleReview.draft.id } })).status === "committed",
      "Successful lifecycle review was not committed.",
    );
    assert(
      (await db.animalProjectAllocation.findUniqueOrThrow({ where: { id: "command-lifecycle-allocation" } })).endedAt?.toISOString().startsWith("2026-07-11"),
      "Lifecycle command did not end the open project allocation on the effective date.",
    );
    const lifecycleMovementWhere = {
      animalId: "command-lifecycle-animal",
      fromCageId: staleBreedingCage.id,
      toCageId: null,
    };
    assert(await db.animalMovement.count({ where: lifecycleMovementWhere }) === 1, "Lifecycle command did not record one cage-detachment movement.");
    assert(await db.animalStatusEvent.count({ where: { animalId: "command-lifecycle-animal", toStatus: "transferred_out" } }) === 1, "Lifecycle command did not record one status event.");
    const lifecycleAudit = await db.auditLog.findFirstOrThrow({
      where: { entityType: "animal", entityId: "command-lifecycle-animal", action: "lifecycle_update" },
      orderBy: { timestamp: "desc" },
    });
    const lifecycleAuditValue = lifecycleAudit.newValue as Record<string, unknown>;
    assert(lifecycleAuditValue.destination === lifecycleCommand.destination, "Lifecycle audit omitted the external destination.");
    assert(lifecycleAuditValue.transferReference === lifecycleCommand.transferReference, "Lifecycle audit omitted the transfer reference.");
    assert(lifecycleAudit.timestamp.getTime() > new Date("2026-07-11T00:00:00.000Z").getTime(), "Lifecycle audit used the effective date as its audit timestamp.");

    const lifecycleReplayReview = await command.prepareWorkflowReview({
      actor,
      draftId: lifecycleReview.draft.id,
      workflowType: "animal.lifecycle",
      requiredCapability: "animals:manage",
      payload: lifecycleReviewPayload,
      allowCommittedReplay: true,
    });
    assert(
      lifecycleReplayReview.ok && lifecycleReplayReview.replayed && lifecycleReplayReview.snapshot.id === lifecycleReview.snapshot.id,
      "Committed lifecycle draft did not recover its immutable review for caller-boundary replay.",
    );
    const lifecycleReplay = await colony.executeUpdateAnimalLifecycleCommand({
      actor,
      command: lifecycleCommand,
      expectedVersion: lifecycleBefore.version,
      idempotencyKey: "command-lifecycle-transfer-key",
      requestId: "command-lifecycle-replay",
      workflowDraftId: lifecycleReplayReview.draft.id,
      reviewSnapshotId: lifecycleReplayReview.snapshot.id,
    });
    assert(lifecycleReplay.ok && lifecycleReplay.replayed, "Lifecycle command did not replay idempotently.");
    assert(await db.animalMovement.count({ where: lifecycleMovementWhere }) === 1, "Lifecycle replay duplicated the cage-detachment movement.");
    assert(await db.animalStatusEvent.count({ where: { animalId: "command-lifecycle-animal", toStatus: "transferred_out" } }) === 1, "Lifecycle replay duplicated the status event.");
    assert(await db.auditLog.count({ where: { entityType: "animal", entityId: "command-lifecycle-animal", action: "lifecycle_update" } }) === 1, "Lifecycle replay duplicated the audit event.");

    const conflictingKeyCommand = {
      animalId: "command-lifecycle-animal",
      targetStatus: "archived" as const,
      happenedAt: "2026-07-12",
      reason: "Conflicting command-key reuse must fail.",
    };
    const conflictingKeyReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-lifecycle-conflicting-key-draft",
      workflowType: "animal.lifecycle",
      requiredCapability: "animals:manage",
      payload: { command: conflictingKeyCommand, expectedVersion: lifecycleAfter.version },
    });
    assert(conflictingKeyReview.ok, "Conflicting-key lifecycle review preparation failed.");
    const conflictingKeyResult = await colony.executeUpdateAnimalLifecycleCommand({
      actor,
      command: conflictingKeyCommand,
      expectedVersion: lifecycleAfter.version,
      idempotencyKey: "command-lifecycle-transfer-key",
      requestId: "command-lifecycle-conflicting-key",
      workflowDraftId: conflictingKeyReview.draft.id,
      reviewSnapshotId: conflictingKeyReview.snapshot.id,
    });
    assert(!conflictingKeyResult.ok && conflictingKeyResult.code === "idempotency_conflict", "Conflicting lifecycle key reuse was not rejected.");
    assert((await db.animal.findUniqueOrThrow({ where: { id: "command-lifecycle-animal" } })).status === "transferred_out", "Conflicting key reuse changed lifecycle state.");
    assert(await db.commandReceipt.count({ where: { actorId: actor.id, commandType: "animal.lifecycle.update", idempotencyKey: "command-lifecycle-transfer-key" } }) === 1, "Conflicting key reuse created a second receipt.");

    const staleLifecycleCommand = {
      animalId: "command-lifecycle-animal",
      targetStatus: "archived" as const,
      happenedAt: "2026-07-12",
      reason: "Stale lifecycle version must be rejected.",
    };
    const staleLifecycleReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-lifecycle-stale-draft",
      workflowType: "animal.lifecycle",
      requiredCapability: "animals:manage",
      payload: { command: staleLifecycleCommand, expectedVersion: lifecycleBefore.version },
    });
    assert(staleLifecycleReview.ok, "Stale lifecycle review preparation failed.");
    const staleLifecycleResult = await colony.executeUpdateAnimalLifecycleCommand({
      actor,
      command: staleLifecycleCommand,
      expectedVersion: lifecycleBefore.version,
      idempotencyKey: staleLifecycleReview.snapshot.id,
      requestId: staleLifecycleReview.snapshot.id,
      workflowDraftId: staleLifecycleReview.draft.id,
      reviewSnapshotId: staleLifecycleReview.snapshot.id,
    });
    assert(!staleLifecycleResult.ok && staleLifecycleResult.code === "stale_conflict", "Stale lifecycle version was not rejected.");

    const validationAnimal = await db.animal.findUniqueOrThrow({
      where: { id: "command-experiment-block-animal" },
      select: { version: true },
    });
    const invalidTransferMetadataCommand = {
      animalId: "command-experiment-block-animal",
      targetStatus: "dead" as const,
      happenedAt: "2026-07-11",
      reason: "Non-transfer disposition must reject transfer metadata.",
      destination: "Misleading External Facility",
      transferReference: "INVALID-METADATA",
    };
    const invalidTransferMetadataReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-lifecycle-invalid-transfer-metadata-draft",
      workflowType: "animal.lifecycle",
      requiredCapability: "animals:manage",
      payload: { command: invalidTransferMetadataCommand, expectedVersion: validationAnimal.version },
    });
    assert(invalidTransferMetadataReview.ok, "Invalid transfer-metadata review preparation failed.");
    const invalidTransferMetadataResult = await colony.executeUpdateAnimalLifecycleCommand({
      actor,
      command: invalidTransferMetadataCommand,
      expectedVersion: validationAnimal.version,
      idempotencyKey: "command-lifecycle-invalid-transfer-metadata",
      requestId: invalidTransferMetadataReview.snapshot.id,
      workflowDraftId: invalidTransferMetadataReview.draft.id,
      reviewSnapshotId: invalidTransferMetadataReview.snapshot.id,
    });
    assert(!invalidTransferMetadataResult.ok && invalidTransferMetadataResult.code === "validation_error", "Non-transfer disposition accepted transfer metadata.");
    const invalidCalendarCommand = {
      animalId: "command-experiment-block-animal",
      targetStatus: "dead" as const,
      happenedAt: "2026-02-30",
      reason: "Invalid calendar dates must not normalize silently.",
    };
    const invalidCalendarReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-lifecycle-invalid-calendar-draft",
      workflowType: "animal.lifecycle",
      requiredCapability: "animals:manage",
      payload: { command: invalidCalendarCommand, expectedVersion: validationAnimal.version },
    });
    assert(invalidCalendarReview.ok, "Invalid-calendar lifecycle review preparation failed.");
    const invalidCalendarResult = await colony.executeUpdateAnimalLifecycleCommand({
      actor,
      command: invalidCalendarCommand,
      expectedVersion: validationAnimal.version,
      idempotencyKey: invalidCalendarReview.snapshot.id,
      requestId: invalidCalendarReview.snapshot.id,
      workflowDraftId: invalidCalendarReview.draft.id,
      reviewSnapshotId: invalidCalendarReview.snapshot.id,
    });
    assert(!invalidCalendarResult.ok && invalidCalendarResult.code === "validation_error", "Invalid calendar date was normalized instead of rejected.");
    assert((await db.workflowDraft.findUniqueOrThrow({ where: { id: invalidCalendarReview.draft.id } })).status === "review", "Invalid calendar date did not restore its review draft.");

    const backdatedAllocationCommand = {
      animalId: "command-experiment-block-animal",
      targetStatus: "dead" as const,
      happenedAt: "2026-07-09",
      reason: "Disposition before an active project allocation must fail.",
    };
    const backdatedAllocationReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-lifecycle-allocation-backdate-draft",
      workflowType: "animal.lifecycle",
      requiredCapability: "animals:manage",
      payload: { command: backdatedAllocationCommand, expectedVersion: validationAnimal.version },
    });
    assert(backdatedAllocationReview.ok, "Allocation-backdate lifecycle review preparation failed.");
    const backdatedAllocationResult = await colony.executeUpdateAnimalLifecycleCommand({
      actor,
      command: backdatedAllocationCommand,
      expectedVersion: validationAnimal.version,
      idempotencyKey: backdatedAllocationReview.snapshot.id,
      requestId: backdatedAllocationReview.snapshot.id,
      workflowDraftId: backdatedAllocationReview.draft.id,
      reviewSnapshotId: backdatedAllocationReview.snapshot.id,
    });
    assert(!backdatedAllocationResult.ok && backdatedAllocationResult.code === "validation_error", "Disposition before an open allocation start was not rejected.");
    assert((await db.animalProjectAllocation.findUniqueOrThrow({ where: { id: "command-lifecycle-backdate-allocation" } })).endedAt === null, "Rejected backdate corrupted the project allocation.");
    await db.animalProjectAllocation.update({
      where: { id: "command-lifecycle-backdate-allocation" },
      data: { endedAt: new Date("2026-07-11T00:00:00.000Z") },
    });
    const completedAllocationAnimal = await db.animal.findUniqueOrThrow({
      where: { id: "command-experiment-block-animal" },
      select: { version: true },
    });
    const completedAllocationBackdateCommand = {
      ...backdatedAllocationCommand,
      reason: "Disposition before a completed project allocation must fail.",
    };
    const completedAllocationBackdateReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-lifecycle-completed-allocation-backdate-draft",
      workflowType: "animal.lifecycle",
      requiredCapability: "animals:manage",
      payload: { command: completedAllocationBackdateCommand, expectedVersion: completedAllocationAnimal.version },
    });
    assert(completedAllocationBackdateReview.ok, "Completed-allocation backdate review preparation failed.");
    const completedAllocationBackdateResult = await colony.executeUpdateAnimalLifecycleCommand({
      actor,
      command: completedAllocationBackdateCommand,
      expectedVersion: completedAllocationAnimal.version,
      idempotencyKey: "command-lifecycle-completed-allocation-backdate",
      requestId: completedAllocationBackdateReview.snapshot.id,
      workflowDraftId: completedAllocationBackdateReview.draft.id,
      reviewSnapshotId: completedAllocationBackdateReview.snapshot.id,
    });
    assert(!completedAllocationBackdateResult.ok && completedAllocationBackdateResult.code === "validation_error", "Disposition before a completed allocation start was not rejected.");

    const experiment = await db.experiment.create({
      data: {
        id: "command-lifecycle-experiment",
        labId: "command-lab",
        experimentCode: "CMD-LIFECYCLE-EXP",
        projectId: "command-lifecycle-project",
        title: "Lifecycle assignment block verification",
        ownerId: actor.id,
        status: "active",
      },
    });
    await db.experimentAssignment.create({
      data: {
        id: "command-lifecycle-experiment-assignment",
        animalId: "command-experiment-block-animal",
        experimentId: experiment.id,
        status: "active",
        startDate: new Date("2026-07-02T00:00:00.000Z"),
      },
    });
    const blockedExperimentAnimal = await db.animal.findUniqueOrThrow({
      where: { id: "command-experiment-block-animal" },
      select: { version: true },
    });
    const blockedExperimentCommand = {
      animalId: "command-experiment-block-animal",
      targetStatus: "dead" as const,
      happenedAt: "2026-07-11",
      reason: "Open experiment assignment must block disposition.",
    };
    const blockedExperimentReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-lifecycle-experiment-block-draft",
      workflowType: "animal.lifecycle",
      requiredCapability: "animals:manage",
      payload: { command: blockedExperimentCommand, expectedVersion: blockedExperimentAnimal.version },
    });
    assert(blockedExperimentReview.ok, "Experiment-block lifecycle review preparation failed.");
    const blockedExperimentResult = await colony.executeUpdateAnimalLifecycleCommand({
      actor,
      command: blockedExperimentCommand,
      expectedVersion: blockedExperimentAnimal.version,
      idempotencyKey: blockedExperimentReview.snapshot.id,
      requestId: blockedExperimentReview.snapshot.id,
      workflowDraftId: blockedExperimentReview.draft.id,
      reviewSnapshotId: blockedExperimentReview.snapshot.id,
    });
    assert(!blockedExperimentResult.ok && blockedExperimentResult.code === "validation_error", "Open experiment assignment did not block lifecycle removal.");
    assert(
      (await db.workflowDraft.findUniqueOrThrow({ where: { id: blockedExperimentReview.draft.id } })).status === "review",
      "Failed lifecycle validation did not restore the reviewed draft.",
    );
    assert(
      (await db.experimentAssignment.findUniqueOrThrow({ where: { id: "command-lifecycle-experiment-assignment" } })).status === "active",
      "Blocked lifecycle command silently changed the experiment assignment.",
    );
    await db.animal.update({
      where: { id: "command-experiment-block-animal" },
      data: { status: "transferred_out", outcomeStatus: "transferred", currentCageId: null },
    });
    const terminalExperimentAnimal = await db.animal.findUniqueOrThrow({
      where: { id: "command-experiment-block-animal" },
      select: { version: true },
    });
    const blockedExperimentArchiveCommand = {
      animalId: "command-experiment-block-animal",
      targetStatus: "archived" as const,
      happenedAt: "2026-07-12",
      reason: "Open experiment assignment must also block archive.",
    };
    const blockedExperimentArchiveReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-lifecycle-experiment-archive-block-draft",
      workflowType: "animal.lifecycle",
      requiredCapability: "animals:manage",
      payload: { command: blockedExperimentArchiveCommand, expectedVersion: terminalExperimentAnimal.version },
    });
    assert(blockedExperimentArchiveReview.ok, "Experiment archive-block review preparation failed.");
    const blockedExperimentArchive = await colony.executeUpdateAnimalLifecycleCommand({
      actor,
      command: blockedExperimentArchiveCommand,
      expectedVersion: terminalExperimentAnimal.version,
      idempotencyKey: blockedExperimentArchiveReview.snapshot.id,
      requestId: blockedExperimentArchiveReview.snapshot.id,
      workflowDraftId: blockedExperimentArchiveReview.draft.id,
      reviewSnapshotId: blockedExperimentArchiveReview.snapshot.id,
    });
    assert(!blockedExperimentArchive.ok && blockedExperimentArchive.code === "validation_error", "Archive bypassed an open experiment assignment.");

    const activeBreeder = await db.animal.findUniqueOrThrow({
      where: { id: "command-breeding-sire-animal" },
      select: { version: true },
    });
    const blockedBreederLifecycleCommand = {
      animalId: "command-breeding-sire-animal",
      targetStatus: "euthanized" as const,
      happenedAt: "2026-07-12",
      reason: "Open breeding relationship must block disposition.",
    };
    const blockedBreederLifecycleReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-lifecycle-breeder-block-draft",
      workflowType: "animal.lifecycle",
      requiredCapability: "animals:manage",
      payload: { command: blockedBreederLifecycleCommand, expectedVersion: activeBreeder.version },
    });
    assert(blockedBreederLifecycleReview.ok, "Breeder-block lifecycle review preparation failed.");
    const blockedBreederLifecycleResult = await colony.executeUpdateAnimalLifecycleCommand({
      actor,
      command: blockedBreederLifecycleCommand,
      expectedVersion: activeBreeder.version,
      idempotencyKey: blockedBreederLifecycleReview.snapshot.id,
      requestId: blockedBreederLifecycleReview.snapshot.id,
      workflowDraftId: blockedBreederLifecycleReview.draft.id,
      reviewSnapshotId: blockedBreederLifecycleReview.snapshot.id,
    });
    assert(!blockedBreederLifecycleResult.ok && blockedBreederLifecycleResult.code === "validation_error", "Open breeding relationship did not block lifecycle removal.");
    await db.animal.update({
      where: { id: "command-breeding-sire-animal" },
      data: { status: "transferred_out", outcomeStatus: "transferred", currentCageId: null },
    });
    const terminalBreeder = await db.animal.findUniqueOrThrow({
      where: { id: "command-breeding-sire-animal" },
      select: { version: true },
    });
    const blockedBreederArchiveCommand = {
      animalId: "command-breeding-sire-animal",
      targetStatus: "archived" as const,
      happenedAt: "2026-07-12",
      reason: "Open breeding relationship must also block archive.",
    };
    const blockedBreederArchiveReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-lifecycle-breeder-archive-block-draft",
      workflowType: "animal.lifecycle",
      requiredCapability: "animals:manage",
      payload: { command: blockedBreederArchiveCommand, expectedVersion: terminalBreeder.version },
    });
    assert(blockedBreederArchiveReview.ok, "Breeder archive-block review preparation failed.");
    const blockedBreederArchive = await colony.executeUpdateAnimalLifecycleCommand({
      actor,
      command: blockedBreederArchiveCommand,
      expectedVersion: terminalBreeder.version,
      idempotencyKey: blockedBreederArchiveReview.snapshot.id,
      requestId: blockedBreederArchiveReview.snapshot.id,
      workflowDraftId: blockedBreederArchiveReview.draft.id,
      reviewSnapshotId: blockedBreederArchiveReview.snapshot.id,
    });
    assert(!blockedBreederArchive.ok && blockedBreederArchive.code === "validation_error", "Archive bypassed an open breeding relationship.");

    const quarantineSeed = await db.$transaction(async (tx) => {
      const cageIds = await command.allocateFacilityIdentifiers(tx, "cage", 2);
      const animalIds = await command.allocateFacilityIdentifiers(tx, "animal", 1);
      const source = await tx.cage.create({
        data: {
          id: "command-quarantine-source",
          facilityCageId: cageIds[0],
          labId: "command-lab",
          roomId: "command-room",
          rackId: "command-rack",
          cageNumber: "Q-001",
          barcode: "CMD-Q-001",
          status: "quarantine",
        },
      });
      const destination = await tx.cage.create({
        data: {
          id: "command-quarantine-destination",
          facilityCageId: cageIds[1],
          labId: "command-lab",
          roomId: "command-room",
          rackId: "command-rack",
          cageNumber: "H-001",
          barcode: "CMD-H-001",
          status: "active",
        },
      });
      const animal = await tx.animal.create({
        data: {
          id: "command-quarantine-animal",
          facilityAnimalId: animalIds[0],
          animalId: "CMD-QUARANTINE-1",
          labId: "CMD-QUARANTINE-LAB-1",
          owningLabId: "command-lab",
          sex: "female",
          dob: new Date("2026-01-01T00:00:00.000Z"),
          strainId: "command-strain",
          currentCageId: source.id,
          status: "colony_holding",
          originType: "verification",
          healthStatus: "Quarantine intake",
        },
      });
      await tx.animalMovement.create({
        data: {
          id: "command-quarantine-initial-move",
          animalId: animal.id,
          fromCageId: null,
          toCageId: source.id,
          movedById: actor.id,
          movedAt: new Date("2026-07-10T00:00:00.000Z"),
          reason: "Quarantine verification intake",
        },
      });
      return { source, destination, animal };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const quarantineSourceVersion = (await db.cage.findUniqueOrThrow({ where: { id: quarantineSeed.source.id }, select: { version: true } })).version;
    const admission = await quarantine.executeAdmitQuarantineCaseCommand({
      actor,
      command: { cageId: quarantineSeed.source.id, admittedAt: "2026-07-10", minimumHoldDays: 1, reason: "Retained quarantine admission verification." },
      expectedCageVersion: quarantineSourceVersion,
      idempotencyKey: "command-quarantine-admit",
      requestId: "command-quarantine-admit",
    });
    assert(admission.ok && !admission.replayed, `Quarantine admission failed: ${JSON.stringify(admission)}.`);
    const admissionPayload = admission.result as { caseId: string };
    const quarantineCaseId = admissionPayload.caseId;
    const admissionReplay = await quarantine.executeAdmitQuarantineCaseCommand({
      actor,
      command: { cageId: quarantineSeed.source.id, admittedAt: "2026-07-10", minimumHoldDays: 1, reason: "Retained quarantine admission verification." },
      expectedCageVersion: quarantineSourceVersion,
      idempotencyKey: "command-quarantine-admit",
      requestId: "command-quarantine-admit-replay",
    });
    assert(admissionReplay.ok && admissionReplay.replayed, "Quarantine admission did not replay safely.");
    assert(await db.quarantineCase.count({ where: { cageId: quarantineSeed.source.id } }) === 1, "Admission replay created a duplicate quarantine case.");

    const spoofedQuarantineNote = await colony.addCageHealthNote({
      cageId: quarantineSeed.source.id,
      noteType: "routine_welfare",
      severity: "warning",
      note: "Ordinary note must not impersonate quarantine provenance.",
      followupRequired: true,
      actionTaken: "Quarantine observation: spoofed",
    }, actor);
    assert(!spoofedQuarantineNote.ok && spoofedQuarantineNote.message.includes("reserved"), "User-authored health note impersonated quarantine provenance.");

    const blockedQuarantineMove = await colony.moveAnimalToCage({
      animalId: quarantineSeed.animal.id,
      toCageId: quarantineSeed.destination.id,
      movedAt: "2026-07-10",
      reason: "Attempt ordinary movement from open quarantine.",
    }, actor);
    assert(!blockedQuarantineMove.ok && blockedQuarantineMove.message.includes("quarantine release workflow"), "Ordinary cage movement bypassed open quarantine containment.");
    const blockedQuarantineMissing = await colony.updateAnimalPresenceStatus({
      animalId: quarantineSeed.animal.id,
      action: "missing",
      happenedAt: "2026-07-10",
      reason: "Attempt presence bypass from open quarantine.",
    }, actor);
    assert(!blockedQuarantineMissing.ok && blockedQuarantineMissing.message.includes("quarantine release workflow"), "Presence workflow bypassed open quarantine containment.");
    const blockedQuarantineStatus = await colony.updateCageDetails({ cageId: quarantineSeed.source.id, status: "active" }, actor);
    assert(!blockedQuarantineStatus.ok && blockedQuarantineStatus.message.includes("quarantine release workflow"), "Cage status edit bypassed open quarantine containment.");
    const blockedQuarantineTransfer = await colony.transferCageToLab({
      cageId: quarantineSeed.source.id,
      toLabId: "command-lab-b",
      movedAt: "2026-07-10",
      reason: "Attempt cage ownership bypass from open quarantine.",
    }, actor);
    assert(
      !blockedQuarantineTransfer.ok && blockedQuarantineTransfer.message.includes("source request"),
      "Legacy direct cage transfer was not disabled during open quarantine containment.",
    );
    const quarantineClosureCommand = {
      cageId: quarantineSeed.source.id,
      labId: "command-lab",
      closedAt: "2026-07-10",
      reason: "Attempt cage closure bypass from open quarantine.",
      expectedChargePeriodId: "quarantine-closure-blocked-before-billing",
      expectedChargeCategoryId: "command-standard",
      expectedChargePeriodStartedAt: "2026-07-01T00:00:00.000Z",
      expectedDailyRateCents: 100,
      expectedCurrencyCode: "USD",
      assignments: [{ animalId: quarantineSeed.animal.id, toCageId: quarantineSeed.destination.id }],
    };
    const quarantineClosureVersion = (await db.cage.findUniqueOrThrow({ where: { id: quarantineSeed.source.id }, select: { version: true } })).version;
    const quarantineClosureReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-quarantine-closure-block-draft",
      workflowType: "cage.closure",
      requiredCapability: "cages:manage",
      labId: quarantineClosureCommand.labId,
      payload: { command: quarantineClosureCommand, expectedVersion: quarantineClosureVersion },
    });
    assert(quarantineClosureReview.ok, "Quarantine closure-block review preparation failed.");
    const blockedQuarantineExit = await cageClosure.executeCloseCageCommand({
      actor,
      command: quarantineClosureCommand,
      expectedVersion: quarantineClosureVersion,
      idempotencyKey: quarantineClosureReview.snapshot.id,
      requestId: quarantineClosureReview.snapshot.id,
      workflowDraftId: quarantineClosureReview.draft.id,
      reviewSnapshotId: quarantineClosureReview.snapshot.id,
    });
    assert(!blockedQuarantineExit.ok && blockedQuarantineExit.message?.includes("quarantine release workflow"), "Cage exit bypassed open quarantine containment.");
    await expectCheckViolation(
      db,
      `UPDATE "Animal" SET "currentCageId" = '${quarantineSeed.destination.id}' WHERE id = '${quarantineSeed.animal.id}'`,
      "Database containment allowed an ordinary animal move from open quarantine.",
    );
    await expectCheckViolation(
      db,
      `UPDATE "Animal" SET "currentCageId" = '${quarantineSeed.destination.id}', "outcomeStatus" = 'transferred' WHERE id = '${quarantineSeed.animal.id}'`,
      "Database containment allowed terminal status to disguise a quarantine relocation.",
    );
    let terminalDetachRolledBack = false;
    try {
      await db.$transaction(async (tx) => {
        await tx.animal.update({
          where: { id: quarantineSeed.animal.id },
          data: { currentCageId: null, outcomeStatus: "dead" },
        });
        throw new Error("expected-terminal-detach-rollback");
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      terminalDetachRolledBack = error instanceof Error && error.message === "expected-terminal-detach-rollback";
    }
    assert(terminalDetachRolledBack, "Open quarantine containment rejected legitimate terminal detachment.");
    await expectCheckViolation(
      db,
      `UPDATE "Cage" SET status = 'active' WHERE id = '${quarantineSeed.source.id}'`,
      "Database containment allowed an open quarantine cage status change.",
    );
    assert((await db.animal.findUniqueOrThrow({ where: { id: quarantineSeed.animal.id } })).currentCageId === quarantineSeed.source.id, "Rejected quarantine bypass changed the animal cage.");

    let quarantineCase = await db.quarantineCase.findUniqueOrThrow({ where: { id: quarantineCaseId } });
    const exceptionObservation = await quarantine.executeRecordQuarantineObservationCommand({
      actor,
      command: { caseId: quarantineCaseId, observedAt: "2026-07-10", result: "exception", severity: "warning", note: "Transient welfare concern requires quarantine follow-up.", followupRequired: true },
      expectedVersion: quarantineCase.version,
      idempotencyKey: "command-quarantine-exception",
      requestId: "command-quarantine-exception",
    });
    assert(exceptionObservation.ok, "Quarantine exception observation failed.");
    quarantineCase = await db.quarantineCase.findUniqueOrThrow({ where: { id: quarantineCaseId } });
    assert(quarantineCase.status === "exception_open", "Quarantine exception did not open the case state.");
    const invalidExceptionClear = await quarantine.executeRecordQuarantineObservationCommand({
      actor,
      command: { caseId: quarantineCaseId, observedAt: "2026-07-10", result: "clear", severity: "info", note: "Ordinary clear must not silently resolve an exception.", followupRequired: false },
      expectedVersion: quarantineCase.version,
      idempotencyKey: "command-quarantine-invalid-clear",
      requestId: "command-quarantine-invalid-clear",
    });
    assert(!invalidExceptionClear.ok && invalidExceptionClear.code === "invalid_transition", "Ordinary clear silently resolved a quarantine exception.");
    const resolvedException = await quarantine.executeRecordQuarantineObservationCommand({
      actor,
      command: { caseId: quarantineCaseId, observedAt: "2026-07-11", result: "exception_resolved", severity: "info", note: "Veterinary review resolved the quarantine exception.", followupRequired: false },
      expectedVersion: quarantineCase.version,
      idempotencyKey: "command-quarantine-resolve",
      requestId: "command-quarantine-resolve",
    });
    assert(resolvedException.ok, "Explicit quarantine exception resolution failed.");
    assert(await db.healthNote.count({
      where: {
        cageId: quarantineSeed.source.id,
        createdAt: { gte: new Date("2026-07-10T00:00:00.000Z") },
        resolved: false,
        OR: [{ followupRequired: true }, { severity: { in: ["warning", "critical"] } }],
      },
    }) === 0, "Explicit exception resolution left an actionable quarantine health note open.");
    quarantineCase = await db.quarantineCase.findUniqueOrThrow({ where: { id: quarantineCaseId } });
    const clearObservation = await quarantine.executeRecordQuarantineObservationCommand({
      actor,
      command: { caseId: quarantineCaseId, observedAt: "2026-07-11", result: "clear", severity: "info", note: "Final quarantine observation is clear.", followupRequired: false },
      expectedVersion: quarantineCase.version,
      idempotencyKey: "command-quarantine-clear",
      requestId: "command-quarantine-clear",
    });
    assert(clearObservation.ok, "Final clear quarantine observation failed.");
    assert(await db.healthNote.count({
      where: {
        cageId: quarantineSeed.source.id,
        createdAt: { gte: new Date("2026-07-10T00:00:00.000Z") },
        resolved: false,
        OR: [{ followupRequired: true }, { severity: { in: ["warning", "critical"] } }],
      },
    }) === 0, "Routine clear quarantine observation created a false open follow-up.");
    quarantineCase = await db.quarantineCase.findUniqueOrThrow({ where: { id: quarantineCaseId } });
    const releaseRequest = await quarantine.executeRequestQuarantineReleaseCommand({
      actor,
      command: { caseId: quarantineCaseId, requestedAt: "2026-07-11", reason: "Minimum hold and clearing observation completed." },
      expectedVersion: quarantineCase.version,
      idempotencyKey: "command-quarantine-release-request",
      requestId: "command-quarantine-release-request",
    });
    assert(releaseRequest.ok, "Quarantine release request failed.");
    quarantineCase = await db.quarantineCase.findUniqueOrThrow({ where: { id: quarantineCaseId } });
    assert(quarantineCase.status === "release_requested", "Quarantine case did not enter release-requested state.");

    const finalizeCommand = {
      caseId: quarantineCaseId,
      releasedAt: "2026-07-12",
      reason: "CMU finalized retained quarantine release verification.",
      assignments: [{ animalId: quarantineSeed.animal.id, toCageId: quarantineSeed.destination.id }],
    };
    const finalizePayload = { command: finalizeCommand, expectedVersion: quarantineCase.version };
    const releaseReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-quarantine-release-draft",
      workflowType: "quarantine.release",
      requiredCapability: "quarantine:manage",
      payload: finalizePayload,
      allowCommittedReplay: true,
    });
    assert(releaseReview.ok, "Quarantine release review preparation failed.");
    await expectCheckViolation(
      db,
      `INSERT INTO "QuarantineObservation" (id, "caseId", "labId", "observedAt", "observedById", result, severity, note, "followupRequired") VALUES ('command-quarantine-post-request-exception', '${quarantineCaseId}', 'command-lab', '2026-07-11T00:00:00.000Z', '${actor.id}', 'exception', 'warning', 'Injected post-request exception must be rejected.', true)`,
      "Database accepted an observation after quarantine release was requested.",
    );
    const finalizedRelease = await quarantine.executeFinalizeQuarantineReleaseCommand({
      actor,
      command: finalizeCommand,
      expectedVersion: quarantineCase.version,
      idempotencyKey: "command-quarantine-finalize",
      requestId: "command-quarantine-finalize",
      workflowDraftId: releaseReview.draft.id,
      reviewSnapshotId: releaseReview.snapshot.id,
    });
    assert(finalizedRelease.ok && !finalizedRelease.replayed, `Quarantine release finalization failed: ${JSON.stringify(finalizedRelease)}.`);
    const [releasedCase, releasedAnimal, releaseMovements, resolvedAlerts] = await Promise.all([
      db.quarantineCase.findUniqueOrThrow({ where: { id: quarantineCaseId } }),
      db.animal.findUniqueOrThrow({ where: { id: quarantineSeed.animal.id } }),
      db.animalMovement.count({ where: { animalId: quarantineSeed.animal.id, fromCageId: quarantineSeed.source.id, toCageId: quarantineSeed.destination.id } }),
      db.alert.count({ where: { entityType: "quarantine_case", entityId: quarantineCaseId, status: "resolved" } }),
    ]);
    assert(releasedCase.status === "released" && releasedCase.releasedAt, "Quarantine case was not finalized.");
    assert(releasedAnimal.currentCageId === quarantineSeed.destination.id && releasedAnimal.healthStatus === "Released from quarantine", "Released animal did not move to the reviewed cage.");
    assert(releaseMovements === 1, "Quarantine release did not create exactly one movement.");
    assert(resolvedAlerts >= 1, "Quarantine release did not resolve the case alert.");
    assert((await db.workflowDraft.findUniqueOrThrow({ where: { id: releaseReview.draft.id } })).status === "committed", "Quarantine release review was not committed.");
    const releaseReplayReview = await command.prepareWorkflowReview({
      actor,
      draftId: releaseReview.draft.id,
      workflowType: "quarantine.release",
      requiredCapability: "quarantine:manage",
      payload: finalizePayload,
      allowCommittedReplay: true,
    });
    assert(releaseReplayReview.ok && releaseReplayReview.replayed, "Committed quarantine release review was not recovered for replay.");
    const releaseReplay = await quarantine.executeFinalizeQuarantineReleaseCommand({
      actor,
      command: finalizeCommand,
      expectedVersion: quarantineCase.version,
      idempotencyKey: "command-quarantine-finalize",
      requestId: "command-quarantine-finalize-replay",
      workflowDraftId: releaseReplayReview.draft.id,
      reviewSnapshotId: releaseReplayReview.snapshot.id,
    });
    assert(releaseReplay.ok && releaseReplay.replayed, "Quarantine release did not replay idempotently.");
    assert(await db.animalMovement.count({ where: { animalId: quarantineSeed.animal.id, fromCageId: quarantineSeed.source.id, toCageId: quarantineSeed.destination.id } }) === 1, "Quarantine release replay duplicated movement history.");
    const observationId = (await db.quarantineObservation.findFirstOrThrow({ where: { caseId: quarantineCaseId } })).id;
    await expectCheckViolation(
      db,
      `UPDATE "QuarantineObservation" SET note = 'mutated' WHERE id = '${observationId}'`,
      "Quarantine observation history was mutable.",
    );
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
      await tx.quarantineObservation.deleteMany({ where: { caseId: quarantineCaseId } });
    });
    assert(await db.quarantineObservation.count({ where: { caseId: quarantineCaseId } }) === 0, "Guarded disposable reseeding could not delete quarantine observations.");

    const closureSeed = await db.$transaction(async (tx) => {
      const cageIds = await command.allocateFacilityIdentifiers(tx, "cage", 7);
      const animalIds = await command.allocateFacilityIdentifiers(tx, "animal", 3);
      const source = await tx.cage.create({
        data: {
          id: "command-close-source",
          facilityCageId: cageIds[0],
          labId: "command-lab",
          roomId: "command-room",
          rackId: "command-rack",
          cageNumber: "CLOSE-001",
          barcode: "CMD-CLOSE-001",
          status: "active",
          lastUpdatedAt: new Date("2026-07-10T00:00:00.000Z"),
        },
      });
      const destination = await tx.cage.create({
        data: {
          id: "command-close-destination",
          facilityCageId: cageIds[1],
          labId: "command-lab",
          roomId: "command-room",
          rackId: "command-rack",
          cageNumber: "CLOSE-002",
          barcode: "CMD-CLOSE-002",
          status: "active",
          lastUpdatedAt: new Date("2026-07-10T00:00:00.000Z"),
        },
      });
      const crossLabDestination = await tx.cage.create({
        data: {
          id: "command-close-cross-lab",
          facilityCageId: cageIds[2],
          labId: "command-lab-b",
          roomId: "command-room",
          rackId: "command-rack",
          cageNumber: "CLOSE-003",
          barcode: "CMD-CLOSE-003",
          status: "active",
          lastUpdatedAt: new Date("2026-07-10T00:00:00.000Z"),
        },
      });
      const invoiceConflictCage = await tx.cage.create({
        data: {
          id: "command-close-invoice-conflict",
          facilityCageId: cageIds[3],
          labId: "command-lab",
          roomId: "command-room",
          rackId: "command-rack",
          cageNumber: "CLOSE-004",
          barcode: "CMD-CLOSE-004",
          status: "active",
          lastUpdatedAt: new Date("2026-07-10T00:00:00.000Z"),
        },
      });
      const rawGuardCage = await tx.cage.create({
        data: {
          id: "command-close-raw-guard",
          facilityCageId: cageIds[4],
          labId: "command-lab",
          roomId: "command-room",
          rackId: "command-rack",
          cageNumber: "CLOSE-005",
          barcode: "CMD-CLOSE-005",
          status: "active",
          lastUpdatedAt: new Date("2026-07-10T00:00:00.000Z"),
        },
      });
      const partialSource = await tx.cage.create({
        data: {
          id: "command-close-partial-source",
          facilityCageId: cageIds[5],
          labId: "command-lab",
          roomId: "command-room",
          rackId: "command-rack",
          cageNumber: "CLOSE-006",
          barcode: "CMD-CLOSE-006",
          status: "active",
          lastUpdatedAt: new Date("2026-07-10T00:00:00.000Z"),
        },
      });
      const partialDestination = await tx.cage.create({
        data: {
          id: "command-close-partial-destination",
          facilityCageId: cageIds[6],
          labId: "command-lab",
          roomId: "command-room",
          rackId: "command-rack",
          cageNumber: "CLOSE-007",
          barcode: "CMD-CLOSE-007",
          status: "active",
          capacityOverride: 1,
          lastUpdatedAt: new Date("2026-07-10T00:00:00.000Z"),
        },
      });
      const animal = await tx.animal.create({
        data: {
          id: "command-close-animal",
          facilityAnimalId: animalIds[0],
          animalId: "CMD-CLOSE-ANIMAL-1",
          labId: "CMD-CLOSE-LAB-1",
          owningLabId: "command-lab",
          sex: "female",
          dob: new Date("2026-01-01T00:00:00.000Z"),
          strainId: "command-strain",
          currentCageId: source.id,
          status: "colony_holding",
          originType: "verification",
        },
      });
      await tx.animalMovement.create({
        data: {
          id: "command-close-initial-move",
          animalId: animal.id,
          fromCageId: null,
          toCageId: source.id,
          movedById: actor.id,
          movedAt: new Date("2026-07-10T00:00:00.000Z"),
          reason: "Cage closure verification setup",
        },
      });
      const partialAnimals = await Promise.all([
        tx.animal.create({
          data: {
            id: "command-close-partial-animal-1",
            facilityAnimalId: animalIds[1],
            animalId: "CMD-CLOSE-PARTIAL-1",
            labId: "CMD-CLOSE-PARTIAL-LAB-1",
            owningLabId: "command-lab",
            sex: "female",
            dob: new Date("2026-01-01T00:00:00.000Z"),
            strainId: "command-strain",
            currentCageId: partialSource.id,
            status: "colony_holding",
            originType: "verification",
          },
        }),
        tx.animal.create({
          data: {
            id: "command-close-partial-animal-2",
            facilityAnimalId: animalIds[2],
            animalId: "CMD-CLOSE-PARTIAL-2",
            labId: "CMD-CLOSE-PARTIAL-LAB-2",
            owningLabId: "command-lab",
            sex: "female",
            dob: new Date("2026-01-01T00:00:00.000Z"),
            strainId: "command-strain",
            currentCageId: partialSource.id,
            status: "colony_holding",
            originType: "verification",
          },
        }),
      ]);
      await tx.cageChargePeriod.createMany({
        data: [
          { id: "command-close-source-period", cageId: source.id, labId: source.labId, categoryId: "command-standard", dailyRateCents: 100, currencyCode: "USD", startedAt: new Date("2026-07-01T00:00:00.000Z") },
          { id: "command-close-destination-period", cageId: destination.id, labId: destination.labId, categoryId: "command-standard", dailyRateCents: 100, currencyCode: "USD", startedAt: new Date("2026-07-01T00:00:00.000Z") },
          { id: "command-close-cross-period", cageId: crossLabDestination.id, labId: crossLabDestination.labId, categoryId: "command-standard", dailyRateCents: 100, currencyCode: "USD", startedAt: new Date("2026-07-01T00:00:00.000Z") },
          { id: "command-close-invoice-period", cageId: invoiceConflictCage.id, labId: invoiceConflictCage.labId, categoryId: "command-standard", dailyRateCents: 100, currencyCode: "USD", startedAt: new Date("2026-07-01T00:00:00.000Z") },
          { id: "command-close-raw-period", cageId: rawGuardCage.id, labId: rawGuardCage.labId, categoryId: "command-standard", dailyRateCents: 100, currencyCode: "USD", startedAt: new Date("2026-07-01T00:00:00.000Z") },
          { id: "command-close-partial-source-period", cageId: partialSource.id, labId: partialSource.labId, categoryId: "command-standard", dailyRateCents: 100, currencyCode: "USD", startedAt: new Date("2026-07-01T00:00:00.000Z") },
          { id: "command-close-partial-destination-period", cageId: partialDestination.id, labId: partialDestination.labId, categoryId: "command-standard", dailyRateCents: 100, currencyCode: "USD", startedAt: new Date("2026-07-01T00:00:00.000Z") },
        ],
      });
      return { source, destination, crossLabDestination, invoiceConflictCage, rawGuardCage, partialSource, partialDestination, partialAnimals, animal };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const sourceClosureVersion = (await db.cage.findUniqueOrThrow({ where: { id: closureSeed.source.id }, select: { version: true } })).version;
    const crossLabClosureCommand = {
      cageId: closureSeed.source.id,
      labId: "command-lab",
      closedAt: "2026-07-13",
      reason: "Cross-lab closure shortcut must be rejected.",
      expectedChargePeriodId: "command-close-source-period",
      expectedChargeCategoryId: "command-standard",
      expectedChargePeriodStartedAt: "2026-07-01T00:00:00.000Z",
      expectedDailyRateCents: 100,
      expectedCurrencyCode: "USD",
      assignments: [{ animalId: closureSeed.animal.id, toCageId: closureSeed.crossLabDestination.id }],
    };
    const crossLabClosureReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-close-cross-lab-draft",
      workflowType: "cage.closure",
      requiredCapability: "cages:manage",
      labId: crossLabClosureCommand.labId,
      payload: { command: crossLabClosureCommand, expectedVersion: sourceClosureVersion },
    });
    assert(crossLabClosureReview.ok, "Cross-lab closure review preparation failed.");
    const crossLabClosure = await cageClosure.executeCloseCageCommand({
      actor,
      command: crossLabClosureCommand,
      expectedVersion: sourceClosureVersion,
      idempotencyKey: crossLabClosureReview.snapshot.id,
      requestId: crossLabClosureReview.snapshot.id,
      workflowDraftId: crossLabClosureReview.draft.id,
      reviewSnapshotId: crossLabClosureReview.snapshot.id,
    });
    assert(!crossLabClosure.ok && crossLabClosure.code === "validation_error", "Cage closure bypassed the cross-lab approval workflow.");
    assert((await db.workflowDraft.findUniqueOrThrow({ where: { id: crossLabClosureReview.draft.id } })).status === "review", "Rejected cross-lab closure did not restore its review draft.");

    const partialClosureVersion = (await db.cage.findUniqueOrThrow({ where: { id: closureSeed.partialSource.id }, select: { version: true } })).version;
    const partialClosureCommand = {
      cageId: closureSeed.partialSource.id,
      labId: "command-lab",
      closedAt: "2026-07-13",
      reason: "Aggregate capacity preflight must reject this complete closure plan.",
      expectedChargePeriodId: "command-close-partial-source-period",
      expectedChargeCategoryId: "command-standard",
      expectedChargePeriodStartedAt: "2026-07-01T00:00:00.000Z",
      expectedDailyRateCents: 100,
      expectedCurrencyCode: "USD",
      assignments: closureSeed.partialAnimals.map((animal) => ({
        animalId: animal.id,
        toCageId: closureSeed.partialDestination.id,
      })),
    };
    const partialClosureReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-close-partial-capacity-draft",
      workflowType: "cage.closure",
      requiredCapability: "cages:manage",
      labId: partialClosureCommand.labId,
      payload: { command: partialClosureCommand, expectedVersion: partialClosureVersion },
    });
    assert(partialClosureReview.ok, "Partial-commit closure review preparation failed.");
    const partialClosure = await cageClosure.executeCloseCageCommand({
      actor,
      command: partialClosureCommand,
      expectedVersion: partialClosureVersion,
      idempotencyKey: partialClosureReview.snapshot.id,
      requestId: partialClosureReview.snapshot.id,
      workflowDraftId: partialClosureReview.draft.id,
      reviewSnapshotId: partialClosureReview.snapshot.id,
    });
    assert(!partialClosure.ok && partialClosure.code === "validation_error", "Aggregate capacity did not reject an overfilled closure plan.");
    assert(
      await db.animal.count({ where: { id: { in: closureSeed.partialAnimals.map((animal) => animal.id) }, currentCageId: closureSeed.partialSource.id } }) === 2,
      "Rejected closure plan partially moved occupants.",
    );
    assert(
      await db.animalMovement.count({ where: { fromCageId: closureSeed.partialSource.id } }) === 0,
      "Rejected closure plan committed partial movement history.",
    );
    assert(await db.cageClosure.count({ where: { cageId: closureSeed.partialSource.id } }) === 0, "Rejected closure plan created a closure record.");

    await db.cage.update({
      where: { id: closureSeed.partialDestination.id },
      data: { capacityOverride: 6, lastUpdatedAt: new Date("2026-07-14T00:00:00.000Z") },
    });
    const destinationChronologyReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-close-destination-chronology-draft",
      workflowType: "cage.closure",
      requiredCapability: "cages:manage",
      labId: partialClosureCommand.labId,
      payload: { command: partialClosureCommand, expectedVersion: partialClosureVersion },
    });
    assert(destinationChronologyReview.ok, "Destination chronology review preparation failed.");
    const destinationChronology = await cageClosure.executeCloseCageCommand({
      actor,
      command: partialClosureCommand,
      expectedVersion: partialClosureVersion,
      idempotencyKey: destinationChronologyReview.snapshot.id,
      requestId: destinationChronologyReview.snapshot.id,
      workflowDraftId: destinationChronologyReview.draft.id,
      reviewSnapshotId: destinationChronologyReview.snapshot.id,
    });
    assert(
      !destinationChronology.ok && destinationChronology.code === "validation_error" && destinationChronology.message?.includes("destination cage activity"),
      "Cage closure backdated transfers before destination-cage activity.",
    );
    assert(await db.animalMovement.count({ where: { fromCageId: closureSeed.partialSource.id } }) === 0, "Chronology rejection moved an occupant.");

    const closeCommand = {
      cageId: closureSeed.source.id,
      labId: "command-lab",
      closedAt: "2026-07-13",
      reason: "Retained cage closure and billing cutoff verification.",
      expectedChargePeriodId: "command-close-source-period",
      expectedChargeCategoryId: "command-standard",
      expectedChargePeriodStartedAt: "2026-07-01T00:00:00.000Z",
      expectedDailyRateCents: 100,
      expectedCurrencyCode: "USD",
      assignments: [{ animalId: closureSeed.animal.id, toCageId: closureSeed.destination.id }],
    };
    const closePayload = { command: closeCommand, expectedVersion: sourceClosureVersion };
    const closeReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-close-success-draft",
      workflowType: "cage.closure",
      requiredCapability: "cages:manage",
      labId: closeCommand.labId,
      payload: closePayload,
      allowCommittedReplay: true,
    });
    assert(closeReview.ok, "Cage closure review preparation failed.");
    const closed = await cageClosure.executeCloseCageCommand({
      actor,
      command: closeCommand,
      expectedVersion: sourceClosureVersion,
      idempotencyKey: "command-close-success",
      requestId: "command-close-success",
      workflowDraftId: closeReview.draft.id,
      reviewSnapshotId: closeReview.snapshot.id,
    });
    assert(closed.ok && !closed.replayed, `Cage closure failed: ${JSON.stringify(closed)}.`);
    const [closedCage, closureRecord, closedPeriod, movedAnimal] = await Promise.all([
      db.cage.findUniqueOrThrow({ where: { id: closureSeed.source.id } }),
      db.cageClosure.findUniqueOrThrow({ where: { cageId: closureSeed.source.id } }),
      db.cageChargePeriod.findUniqueOrThrow({ where: { id: "command-close-source-period" } }),
      db.animal.findUniqueOrThrow({ where: { id: closureSeed.animal.id } }),
    ]);
    assert(!closedCage.active && closedCage.status === "closed", "Cage closure did not produce terminal cage state.");
    assert(closureRecord.closedAt.toISOString() === "2026-07-13T00:00:00.000Z", "Cage closure date was not preserved exactly.");
    assert(closureRecord.billingCutoffAt.getTime() === closureRecord.closedAt.getTime(), "Billing cutoff diverged from the closure date.");
    assert(closureRecord.chargePeriodId === closedPeriod.id && closedPeriod.endedAt?.getTime() === closureRecord.billingCutoffAt.getTime(), "Final charge period did not end at the immutable cutoff.");
    assert(movedAnimal.currentCageId === closureSeed.destination.id, "Cage closure did not move the reviewed occupant.");
    assert(await db.animalMovement.count({ where: { animalId: closureSeed.animal.id, fromCageId: closureSeed.source.id, toCageId: closureSeed.destination.id } }) === 1, "Cage closure did not create exactly one occupant movement.");
    assert(await db.auditLog.count({ where: { entityType: "cage", entityId: closureSeed.source.id, action: "close" } }) === 1, "Cage closure did not create exactly one closure audit.");
    assert((await db.workflowDraft.findUniqueOrThrow({ where: { id: closeReview.draft.id } })).status === "committed", "Cage closure review was not committed.");

    const closeReplayReview = await command.prepareWorkflowReview({
      actor,
      draftId: closeReview.draft.id,
      workflowType: "cage.closure",
      requiredCapability: "cages:manage",
      labId: closeCommand.labId,
      payload: closePayload,
      allowCommittedReplay: true,
    });
    assert(closeReplayReview.ok && closeReplayReview.replayed, "Committed cage closure review was not recovered for replay.");
    const closeReplay = await cageClosure.executeCloseCageCommand({
      actor,
      command: closeCommand,
      expectedVersion: sourceClosureVersion,
      idempotencyKey: "command-close-success",
      requestId: "command-close-success-replay",
      workflowDraftId: closeReplayReview.draft.id,
      reviewSnapshotId: closeReplayReview.snapshot.id,
    });
    assert(closeReplay.ok && closeReplay.replayed, "Cage closure did not replay idempotently.");
    assert(await db.animalMovement.count({ where: { animalId: closureSeed.animal.id, fromCageId: closureSeed.source.id, toCageId: closureSeed.destination.id } }) === 1, "Cage closure replay duplicated movement history.");
    assert(await db.auditLog.count({ where: { entityType: "cage", entityId: closureSeed.source.id, action: "close" } }) === 1, "Cage closure replay duplicated its audit.");

    const conflictingClosure = await cageClosure.executeCloseCageCommand({
      actor,
      command: { ...closeCommand, reason: "Conflicting closure payload." },
      expectedVersion: sourceClosureVersion,
      idempotencyKey: "command-close-success",
      requestId: "command-close-conflict",
      workflowDraftId: closeReplayReview.draft.id,
      reviewSnapshotId: closeReplayReview.snapshot.id,
    });
    assert(!conflictingClosure.ok && conflictingClosure.code === "idempotency_conflict", "Conflicting cage-closure key reuse was not rejected.");

    await expectCheckViolation(db, `UPDATE "Cage" SET status = 'active', active = true WHERE id = '${closureSeed.source.id}'`, "Database reopened a closed cage.");
    await expectCheckViolation(db, `UPDATE "Cage" SET "cageNumber" = 'CLOSE-REASSIGNED' WHERE id = '${closureSeed.source.id}'`, "Database operationally reassigned a closed cage.");
    await expectCheckViolation(db, `UPDATE "CageChargePeriod" SET "endedAt" = '2026-07-14T00:00:00.000Z' WHERE id = 'command-close-source-period'`, "Database changed an immutable cage billing cutoff.");
    await expectCheckViolation(db, `INSERT INTO "CageChargePeriod" (id, "cageId", "labId", "categoryId", "dailyRateCents", "currencyCode", "startedAt") VALUES ('command-close-late-period', '${closureSeed.source.id}', 'command-lab', 'command-standard', 100, 'USD', '2026-07-14T00:00:00.000Z')`, "Database created a charge period after cage closure.");
    await expectCheckViolation(db, `UPDATE "CageChargePeriod" SET "cageId" = '${closureSeed.source.id}' WHERE id = 'command-close-destination-period'`, "Database moved a charge period onto a closed cage.");
    await expectCheckViolation(db, `UPDATE "CageClosure" SET reason = 'Mutated closure reason.' WHERE "cageId" = '${closureSeed.source.id}'`, "Cage closure history was mutable.");
    await expectCheckViolation(db, `DELETE FROM "CageClosure" WHERE "cageId" = '${closureSeed.source.id}'`, "Cage closure history was deletable.");
    await expectCheckViolation(db, `UPDATE "AnimalMovement" SET reason = 'Mutated closure move.' WHERE "animalId" = '${closureSeed.animal.id}' AND "fromCageId" = '${closureSeed.source.id}'`, "Reviewed closure movement history was mutable.");
    await expectCheckViolation(db, `DELETE FROM "AnimalMovement" WHERE "animalId" = '${closureSeed.animal.id}' AND "fromCageId" = '${closureSeed.source.id}'`, "Reviewed closure movement history was deletable.");

    const sourceChronologyVersion = (await db.cage.findUniqueOrThrow({ where: { id: closureSeed.rawGuardCage.id }, select: { version: true } })).version;
    const staleFinancialCommand = {
      cageId: closureSeed.rawGuardCage.id,
      labId: "command-lab",
      closedAt: "2026-07-13",
      reason: "Reviewed financial terms must match the active period.",
      expectedChargePeriodId: "command-close-raw-period",
      expectedChargeCategoryId: "command-standard",
      expectedChargePeriodStartedAt: "2026-07-01T00:00:00.000Z",
      expectedDailyRateCents: 999,
      expectedCurrencyCode: "USD",
      assignments: [],
    };
    const staleFinancialReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-close-stale-financial-review-draft",
      workflowType: "cage.closure",
      requiredCapability: "cages:manage",
      labId: staleFinancialCommand.labId,
      payload: { command: staleFinancialCommand, expectedVersion: sourceChronologyVersion },
    });
    assert(staleFinancialReview.ok, "Stale financial closure review preparation failed.");
    const staleFinancial = await cageClosure.executeCloseCageCommand({
      actor,
      command: staleFinancialCommand,
      expectedVersion: sourceChronologyVersion,
      idempotencyKey: staleFinancialReview.snapshot.id,
      requestId: staleFinancialReview.snapshot.id,
      workflowDraftId: staleFinancialReview.draft.id,
      reviewSnapshotId: staleFinancialReview.snapshot.id,
    });
    assert(!staleFinancial.ok && staleFinancial.code === "stale_conflict", "Cage closure ignored changed reviewed financial terms.");
    const sourceChronologyCommand = {
      cageId: closureSeed.rawGuardCage.id,
      labId: "command-lab",
      closedAt: "2026-07-09",
      reason: "Source chronology must reject backdated closure.",
      expectedChargePeriodId: "command-close-raw-period",
      expectedChargeCategoryId: "command-standard",
      expectedChargePeriodStartedAt: "2026-07-01T00:00:00.000Z",
      expectedDailyRateCents: 100,
      expectedCurrencyCode: "USD",
      assignments: [],
    };
    const sourceChronologyReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-close-source-chronology-draft",
      workflowType: "cage.closure",
      requiredCapability: "cages:manage",
      labId: sourceChronologyCommand.labId,
      payload: { command: sourceChronologyCommand, expectedVersion: sourceChronologyVersion },
    });
    assert(sourceChronologyReview.ok, "Source chronology review preparation failed.");
    const sourceChronology = await cageClosure.executeCloseCageCommand({
      actor,
      command: sourceChronologyCommand,
      expectedVersion: sourceChronologyVersion,
      idempotencyKey: sourceChronologyReview.snapshot.id,
      requestId: sourceChronologyReview.snapshot.id,
      workflowDraftId: sourceChronologyReview.draft.id,
      reviewSnapshotId: sourceChronologyReview.snapshot.id,
    });
    assert(!sourceChronology.ok && sourceChronology.code === "validation_error", "Cage closure predated source-cage activity.");

    const rawGuardCommand = { ...sourceChronologyCommand, closedAt: "2026-07-13", reason: "Reviewed raw closure guard payload." };
    const rawGuardReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-close-raw-review-binding-draft",
      workflowType: "cage.closure",
      requiredCapability: "cages:manage",
      labId: rawGuardCommand.labId,
      payload: { command: rawGuardCommand, expectedVersion: sourceChronologyVersion },
    });
    assert(rawGuardReview.ok, "Raw closure payload-binding review preparation failed.");
    await db.workflowDraft.update({
      where: { id: rawGuardReview.draft.id },
      data: { status: "submitted", submittedAt: new Date() },
    });
    await expectCheckViolation(
      db,
      `UPDATE "CageChargePeriod" SET "endedAt" = '2026-07-13T00:00:00.000Z' WHERE id = 'command-close-raw-period'; UPDATE "Cage" SET status = 'closed', active = false WHERE id = '${closureSeed.rawGuardCage.id}'; INSERT INTO "CageClosure" (id, "cageId", "labId", "chargePeriodId", "reviewSnapshotId", "closedAt", "billingCutoffAt", reason, "closedById") VALUES ('command-close-tampered-review', '${closureSeed.rawGuardCage.id}', 'command-lab', 'command-close-raw-period', '${rawGuardReview.snapshot.id}', '2026-07-13T00:00:00.000Z', '2026-07-13T00:00:00.000Z', 'Tampered after review.', '${actor.id}')`,
      "Database accepted a cage closure that differed from its reviewed payload.",
    );
    await expectCheckViolation(
      db,
      `UPDATE "CageChargePeriod" SET "endedAt" = '2026-07-13T00:00:00.000Z' WHERE id = 'command-close-raw-period'; UPDATE "Cage" SET status = 'closed', active = false WHERE id = '${closureSeed.rawGuardCage.id}'; SET CONSTRAINTS "Cage_explicit_closure_required" IMMEDIATE`,
      "Database accepted a closed cage without an explicit closure record.",
    );

    const invoiceConflictVersion = (await db.cage.findUniqueOrThrow({ where: { id: closureSeed.invoiceConflictCage.id }, select: { version: true } })).version;
    await db.invoice.create({
      data: {
        id: "command-close-finalized-invoice",
        invoiceNumber: "CMD-CLOSE-FINALIZED",
        labId: "command-lab",
        status: "draft",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-14T00:00:00.000Z"),
        currencyCode: "USD",
        subtotalCents: 1300,
        totalCents: 1300,
        lineItems: {
          create: {
            id: "command-close-finalized-line",
            cageId: closureSeed.invoiceConflictCage.id,
            chargePeriodId: "command-close-invoice-period",
            categoryId: "command-standard",
            description: "Finalized closure conflict",
            serviceStart: new Date("2026-07-01T00:00:00.000Z"),
            serviceEnd: new Date("2026-07-14T00:00:00.000Z"),
            dayCount: 13,
            dailyRateCents: 100,
            amountCents: 1300,
          },
        },
      },
    });
    await db.invoice.update({
      where: { id: "command-close-finalized-invoice" },
      data: {
        status: "finalized",
        finalNumber: "INV-2026-900001",
        finalizedAt: new Date("2026-07-14T00:00:00.000Z"),
        finalizedById: actor.id,
        version: { increment: 1 },
      },
    });
    const invoiceConflictCommand = {
      cageId: closureSeed.invoiceConflictCage.id,
      labId: "command-lab",
      closedAt: "2026-07-13",
      reason: "Finalized invoice conflict must block closure.",
      expectedChargePeriodId: "command-close-invoice-period",
      expectedChargeCategoryId: "command-standard",
      expectedChargePeriodStartedAt: "2026-07-01T00:00:00.000Z",
      expectedDailyRateCents: 100,
      expectedCurrencyCode: "USD",
      assignments: [],
    };
    const invoiceConflictReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-close-invoice-conflict-draft",
      workflowType: "cage.closure",
      requiredCapability: "cages:manage",
      labId: invoiceConflictCommand.labId,
      payload: { command: invoiceConflictCommand, expectedVersion: invoiceConflictVersion },
    });
    assert(invoiceConflictReview.ok, "Finalized-invoice closure review preparation failed.");
    const invoiceConflict = await cageClosure.executeCloseCageCommand({
      actor,
      command: invoiceConflictCommand,
      expectedVersion: invoiceConflictVersion,
      idempotencyKey: invoiceConflictReview.snapshot.id,
      requestId: invoiceConflictReview.snapshot.id,
      workflowDraftId: invoiceConflictReview.draft.id,
      reviewSnapshotId: invoiceConflictReview.snapshot.id,
    });
    assert(!invoiceConflict.ok && invoiceConflict.code === "invoice_conflict", "Cage closure invalidated finalized invoice service dates.");
    assert((await db.workflowDraft.findUniqueOrThrow({ where: { id: invoiceConflictReview.draft.id } })).status === "review", "Finalized-invoice conflict did not restore the closure review.");
    assert(await db.cageClosure.count({ where: { cageId: closureSeed.invoiceConflictCage.id } }) === 0, "Rejected invoice-conflict closure created a closure record.");

    await db.invoice.update({
      where: { id: "command-close-finalized-invoice" },
      data: {
        status: "void",
        voidedAt: new Date("2026-07-15T00:00:00.000Z"),
        voidedById: actor.id,
        voidReason: "Replace with draft-conflict verification.",
        version: { increment: 1 },
      },
    });
    await db.invoice.create({
      data: {
        id: "command-close-draft-invoice",
        invoiceNumber: "CMD-CLOSE-DRAFT",
        labId: "command-lab",
        status: "draft",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-20T00:00:00.000Z"),
        currencyCode: "USD",
        subtotalCents: 1900,
        totalCents: 1900,
        lineItems: {
          create: {
            id: "command-close-draft-line",
            cageId: closureSeed.invoiceConflictCage.id,
            chargePeriodId: "command-close-invoice-period",
            categoryId: "command-standard",
            description: "Draft closure conflict",
            serviceStart: new Date("2026-07-01T00:00:00.000Z"),
            serviceEnd: new Date("2026-07-20T00:00:00.000Z"),
            dayCount: 19,
            dailyRateCents: 100,
            amountCents: 1900,
          },
        },
      },
    });
    const draftInvoiceClosureReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-close-draft-invoice-conflict-draft",
      workflowType: "cage.closure",
      requiredCapability: "cages:manage",
      labId: invoiceConflictCommand.labId,
      payload: { command: invoiceConflictCommand, expectedVersion: invoiceConflictVersion },
    });
    assert(draftInvoiceClosureReview.ok, "Draft-invoice closure review preparation failed.");
    const draftInvoiceConflict = await cageClosure.executeCloseCageCommand({
      actor,
      command: invoiceConflictCommand,
      expectedVersion: invoiceConflictVersion,
      idempotencyKey: draftInvoiceClosureReview.snapshot.id,
      requestId: draftInvoiceClosureReview.snapshot.id,
      workflowDraftId: draftInvoiceClosureReview.draft.id,
      reviewSnapshotId: draftInvoiceClosureReview.snapshot.id,
    });
    assert(!draftInvoiceConflict.ok && draftInvoiceConflict.code === "invoice_conflict", "Cage closure left a stale draft invoice beyond its cutoff.");
    assert(await db.cageClosure.count({ where: { cageId: closureSeed.invoiceConflictCage.id } }) === 0, "Draft-invoice conflict created a closure record.");

    const staleClosureVersion = (await db.cage.findUniqueOrThrow({ where: { id: closureSeed.invoiceConflictCage.id }, select: { version: true } })).version;
    const staleClosureCommand = { ...invoiceConflictCommand, closedAt: "2026-07-20", reason: "Stale cage version must block closure." };
    const staleClosureReview = await command.prepareWorkflowReview({
      actor,
      draftId: "command-close-stale-draft",
      workflowType: "cage.closure",
      requiredCapability: "cages:manage",
      labId: staleClosureCommand.labId,
      payload: { command: staleClosureCommand, expectedVersion: staleClosureVersion },
    });
    assert(staleClosureReview.ok, "Stale closure review preparation failed.");
    await db.cage.update({ where: { id: closureSeed.invoiceConflictCage.id }, data: { notes: "Concurrent cage edit" } });
    const staleClosure = await cageClosure.executeCloseCageCommand({
      actor,
      command: staleClosureCommand,
      expectedVersion: staleClosureVersion,
      idempotencyKey: staleClosureReview.snapshot.id,
      requestId: staleClosureReview.snapshot.id,
      workflowDraftId: staleClosureReview.draft.id,
      reviewSnapshotId: staleClosureReview.snapshot.id,
    });
    assert(!staleClosure.ok && staleClosure.code === "stale_conflict", "Stale cage closure version was not rejected.");
    assert(await db.cageClosure.count({ where: { cageId: closureSeed.invoiceConflictCage.id } }) === 0, "Stale cage closure created side effects.");

    await db.invoice.create({
      data: {
        id: "command-stale-finalization-invoice",
        invoiceNumber: "CMD-STALE-FINALIZATION",
        labId: "command-lab",
        status: "draft",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-20T00:00:00.000Z"),
        currencyCode: "USD",
        subtotalCents: 1900,
        totalCents: 1900,
        lineItems: {
          create: {
            id: "command-stale-finalization-line",
            cageId: closureSeed.partialDestination.id,
            chargePeriodId: "command-close-partial-destination-period",
            categoryId: "command-standard",
            description: "Stale finalization guard",
            serviceStart: new Date("2026-07-01T00:00:00.000Z"),
            serviceEnd: new Date("2026-07-20T00:00:00.000Z"),
            dayCount: 19,
            dailyRateCents: 100,
            amountCents: 1900,
          },
        },
      },
    });
    await db.cageChargePeriod.update({
      where: { id: "command-close-partial-destination-period" },
      data: { endedAt: new Date("2026-07-13T00:00:00.000Z") },
    });
    const staleFinalization = await billing.finalizeInvoice({
      invoiceId: "command-stale-finalization-invoice",
      labId: "command-lab",
      expectedVersion: 1,
      idempotencyKey: "command-stale-invoice-finalization",
      requestId: "command-stale-invoice-finalization-request",
    }, actor);
    assert(!staleFinalization.ok && staleFinalization.message.includes("Regenerate"), "Application finalized an invoice beyond the current charge-period cutoff.");
    await expectCheckViolation(
      db,
      `UPDATE "Invoice" SET status = 'finalized', "finalizedAt" = CURRENT_TIMESTAMP, "finalizedById" = '${actor.id}' WHERE id = 'command-stale-finalization-invoice'`,
      "Database finalized an invoice beyond the current charge-period cutoff.",
    );

    const request = { animalId: "command-animal", note: "command applied" };
    const first = await command.executeIdempotentCommand({
      actor,
      commandType: "animal.note.update",
      idempotencyKey: "command-verification-1",
      requestId: "request-command-verification-1",
      request,
      requiredCapability: "animals:manage",
      labId: "command-lab",
      aggregateType: "animal",
      aggregateId: "command-animal",
      expectedVersion: 2,
      handler: async (tx) => {
        const animal = await tx.animal.update({
          where: { id: "command-animal" },
          data: { notes: "command applied" },
          select: { version: true },
        });
        await command.enqueueOutboxMessage(tx, {
          topic: "billing.invoice",
          aggregateType: "animal",
          aggregateId: "command-animal",
          actor,
          labId: "command-lab",
          payload: { animalId: "command-animal" },
          dedupeKey: "command-verification-outbox",
        });
        return {
          ok: true as const,
          result: { applied: true },
          aggregateType: "animal",
          aggregateId: "command-animal",
          resultingVersion: animal.version,
        };
      },
    });
    assert(first.ok && !first.replayed, "Initial idempotent command did not succeed.");

    const replay = await command.executeIdempotentCommand({
      actor,
      commandType: "animal.note.update",
      idempotencyKey: "command-verification-1",
      requestId: "request-command-verification-replay",
      request,
      requiredCapability: "animals:manage",
      labId: "command-lab",
      aggregateType: "animal",
      aggregateId: "command-animal",
      expectedVersion: 2,
      handler: async () => { throw new Error("A replay must not execute the handler."); },
    });
    assert(replay.ok && replay.replayed, "Matching idempotent command was not replayed.");

    const conflict = await command.executeIdempotentCommand({
      actor,
      commandType: "animal.note.update",
      idempotencyKey: "command-verification-1",
      requestId: "request-command-verification-conflict",
      request: { animalId: "command-animal", note: "different" },
      requiredCapability: "animals:manage",
      labId: "command-lab",
      aggregateType: "animal",
      aggregateId: "command-animal",
      expectedVersion: 2,
      handler: async () => ({ ok: true as const, result: { unreachable: true } }),
    });
    assert(
      !conflict.ok && conflict.code === "idempotency_conflict",
      `Conflicting idempotency-key reuse was not rejected: ${JSON.stringify(conflict)}.`,
    );

    const labEnvelope = await command.executeIdempotentCommand({
      actor,
      commandType: "animal.envelope.verification",
      idempotencyKey: "command-verification-envelope",
      requestId: "request-command-verification-envelope-a",
      request: { operation: "same-payload" },
      requiredCapability: "animals:manage",
      labId: "command-lab",
      handler: async () => ({ ok: true as const, result: { lab: "a" } }),
    });
    assert(labEnvelope.ok, "Initial lab-bound command failed.");
    const crossLabReplay = await command.executeIdempotentCommand({
      actor,
      commandType: "animal.envelope.verification",
      idempotencyKey: "command-verification-envelope",
      requestId: "request-command-verification-envelope-b",
      request: { operation: "same-payload" },
      requiredCapability: "animals:manage",
      labId: "command-lab-b",
      handler: async () => ({ ok: true as const, result: { unreachable: true } }),
    });
    assert(!crossLabReplay.ok && crossLabReplay.code === "idempotency_conflict", "Cross-lab command envelope replay was not rejected.");

    const foreignAggregate = await command.executeIdempotentCommand({
      actor,
      commandType: "animal.foreign-aggregate.verification",
      idempotencyKey: "command-verification-foreign-aggregate",
      requestId: "request-command-verification-foreign-aggregate",
      request: { animalId: "command-animal-skip-0" },
      requiredCapability: "animals:manage",
      labId: "command-lab-b",
      aggregateType: "animal",
      aggregateId: "command-animal-skip-0",
      expectedVersion: 1,
      handler: async () => ({ ok: true as const, result: { unreachable: true } }),
    });
    assert(!foreignAggregate.ok && foreignAggregate.code === "not_found", "Foreign-lab aggregate version was disclosed.");

    const concurrentCommand = () => command.executeIdempotentCommand({
      actor,
      commandType: "animal.concurrent.verification",
      idempotencyKey: "command-verification-concurrent",
      requestId: "request-command-verification-concurrent",
      request: { animalId: "command-animal", operation: "concurrent" },
      requiredCapability: "animals:manage",
      labId: "command-lab",
      handler: async (tx) => {
        await tx.auditLog.create({
          data: {
            id: "command-concurrent-side-effect",
            actorId: actor.id,
            entityType: "animal",
            entityId: "command-animal",
            action: "command_concurrency_verified",
            timestamp: new Date(),
          },
        });
        return { ok: true as const, result: { applied: true } };
      },
    });
    const concurrent = await Promise.all([concurrentCommand(), concurrentCommand()]);
    let concurrentAfterRetry = [...concurrent];
    for (let attempt = 0; attempt < 5 && concurrentAfterRetry.some((result) => !result.ok); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await db.$disconnect();
      await db.$connect();
      concurrentAfterRetry = await Promise.all(
        concurrentAfterRetry.map((result) => result.ok ? result : concurrentCommand()),
      );
    }
    assert(
      concurrentAfterRetry.every((result) => result.ok),
      `Concurrent duplicate command failed after stable-key retry: ${JSON.stringify(concurrentAfterRetry)}.`,
    );
    assert(
      concurrentAfterRetry.filter((result) => result.ok && result.replayed).length >= 1,
      "Concurrent duplicate was not replayed after stable-key retry.",
    );
    assert(
      await db.auditLog.count({ where: { id: "command-concurrent-side-effect" } }) === 1,
      "Concurrent duplicate command committed more than one side effect.",
    );

    const stale = await command.executeIdempotentCommand({
      actor,
      commandType: "animal.note.stale",
      idempotencyKey: "command-verification-stale",
      requestId: "request-command-verification-stale",
      request: { animalId: "command-animal" },
      requiredCapability: "animals:manage",
      labId: "command-lab",
      aggregateType: "animal",
      aggregateId: "command-animal",
      expectedVersion: 1,
      handler: async () => ({ ok: true as const, result: { unreachable: true } }),
    });
    assert(!stale.ok && stale.code === "stale_conflict", "Stale aggregate command was not rejected structurally.");

    const claimed = await command.claimOutboxMessages({ worker: billingWorker });
    assert(claimed.length === 1 && claimed[0].attemptCount === 1, "Outbox message was not leased with an attempt.");
    assert(await command.reauthorizeOutboxMessage(claimed[0]), "Outbox delegated authority did not reauthorize.");
    assert(await command.completeOutboxMessage({
      messageId: claimed[0].id,
      worker: billingWorker,
      leaseToken: claimed[0].leaseToken!,
    }), "Outbox completion failed.");
    const deliveredAttempt = await db.outboxDeliveryAttempt.findUnique({
      where: { leaseToken: claimed[0].leaseToken! },
    });
    assert(deliveredAttempt?.status === "delivered", "Outbox attempt was not marked delivered.");

    await db.$transaction((tx) => command.enqueueOutboxMessage(tx, {
      topic: "billing.invoice",
      aggregateType: "animal",
      aggregateId: "command-animal",
      actor,
      labId: "command-lab",
      payload: { deadLetter: true },
      dedupeKey: "command-verification-dead-letter",
      maxAttempts: 1,
    }));
    const deadLetterClaim = await command.claimOutboxMessages({ worker: backupBillingWorker });
    assert(deadLetterClaim.length === 1, "Dead-letter fixture was not leased.");
    assert(await command.failOutboxMessage({
      messageId: deadLetterClaim[0].id,
      worker: backupBillingWorker,
      leaseToken: deadLetterClaim[0].leaseToken!,
      errorMessage: "permanent verification failure",
    }), "Outbox failure recording failed.");
    const deadLetter = await db.outboxMessage.findUniqueOrThrow({ where: { id: deadLetterClaim[0].id } });
    assert(deadLetter.status === "dead_letter" && deadLetter.deadLetteredAt, "Exhausted outbox message was not dead-lettered.");

    const crashMessage = await db.$transaction((tx) => command.enqueueOutboxMessage(tx, {
      topic: "billing.invoice",
      aggregateType: "animal",
      aggregateId: "command-animal",
      actor,
      labId: "command-lab",
      payload: { crashAtFinalAttempt: true },
      dedupeKey: "command-verification-final-lease-crash",
      maxAttempts: 1,
    }));
    const crashClaim = await command.claimOutboxMessages({ worker: billingWorker });
    assert(crashClaim.some((message) => message.id === crashMessage.id), "Final-attempt crash fixture was not leased.");
    await db.outboxMessage.update({
      where: { id: crashMessage.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    await command.claimOutboxMessages({ worker: backupBillingWorker });
    const sweptCrash = await db.outboxMessage.findUniqueOrThrow({ where: { id: crashMessage.id } });
    assert(sweptCrash.status === "dead_letter" && sweptCrash.deadLetteredAt, "Expired final lease was not swept to dead letter.");
    const sweptAttempt = await db.outboxDeliveryAttempt.findUniqueOrThrow({ where: { leaseToken: crashClaim.find((message) => message.id === crashMessage.id)!.leaseToken! } });
    assert(sweptAttempt.status === "failed", "Expired final delivery attempt was not closed.");

    const migrationRun = await command.createMigrationRun({
      actor,
      runKey: "command-verification-run",
      migrationType: "ownership_backfill",
    });
    assert(migrationRun.ok, "Migration run creation failed.");
    const exceptionResult = await command.recordOwnershipException({
      actor,
      migrationRunId: migrationRun.run.id,
      entityType: "Animal",
      entityId: "legacy-animal",
      fieldName: "owningLabId",
      candidates: ["command-lab"],
      reason: "Verification fixture requires explicit ownership resolution.",
    });
    assert(exceptionResult.ok, "Ownership exception recording failed.");
    const resolved = await command.resolveOwnershipException({
      actor,
      exceptionId: exceptionResult.exception.id,
      resolution: { labId: "command-lab", reason: "verified" },
    });
    assert(resolved.ok, "Ownership exception resolution failed.");

    await db.user.create({
      data: {
        id: "command-lab-owner",
        name: "Command Lab Owner",
        email: "command-lab-owner@example.test",
        passwordHash: "not-a-login-hash",
        role: "lab_user",
        labMemberships: { create: { id: "command-lab-owner-membership", labId: "command-lab", role: "owner" } },
      },
    });
    const ownerMembership = { labId: "command-lab", labName: "Command Lab", labCode: "CMD", role: "owner" as const };
    const labOwnerActor = {
      id: "command-lab-owner",
      email: "command-lab-owner@example.test",
      name: "Command Lab Owner",
      role: "animal_staff" as const,
      databaseRole: "lab_user" as const,
      canonicalRole: "lab_user" as const,
      authzVersion: 1,
      activeLabId: "command-lab",
      activeMembership: ownerMembership,
      memberships: [ownerMembership],
      capabilities: [...getActorCapabilities({ canonicalRole: "lab_user", activeMembership: ownerMembership })],
    };
    const ownerMigration = await command.createMigrationRun({
      actor: labOwnerActor,
      runKey: "lab-owner-must-not-create-migration-run",
      migrationType: "ownership_backfill",
    });
    assert(!ownerMigration.ok && ownerMigration.code === "forbidden", "Lab owner received global migration authority.");

    await db.user.create({
      data: {
        id: "command-replay-user",
        name: "Command Replay User",
        email: "command-replay-user@example.test",
        passwordHash: "not-a-login-hash",
        role: "facility_admin",
      },
    });
    const replayActor = { ...actor, id: "command-replay-user", email: "command-replay-user@example.test" };
    const replaySeed = await command.executeIdempotentCommand({
      actor: replayActor,
      commandType: "authorization.replay.verification",
      idempotencyKey: "authorization-replay",
      requestId: "authorization-replay-seed",
      request: { operation: "read-result" },
      requiredCapability: "animals:manage",
      handler: async () => ({ ok: true as const, result: { privateResult: "must-not-replay" } }),
    });
    assert(replaySeed.ok, "Authorization replay seed command failed.");
    const revokedOutbox = await db.$transaction((tx) => command.enqueueOutboxMessage(tx, {
      topic: "billing.invoice",
      aggregateType: "animal",
      aggregateId: "command-animal",
      actor: replayActor,
      payload: { privateResult: "must-not-deliver" },
      dedupeKey: "revoked-actor-outbox",
    }));
    await db.user.update({ where: { id: "command-replay-user" }, data: { active: false } });
    const revokedReplay = await command.executeIdempotentCommand({
      actor: replayActor,
      commandType: "authorization.replay.verification",
      idempotencyKey: "authorization-replay",
      requestId: "authorization-replay-retry",
      request: { operation: "read-result" },
      requiredCapability: "animals:manage",
      handler: async () => ({ ok: true as const, result: { unreachable: true } }),
    });
    assert(!revokedReplay.ok && revokedReplay.code === "forbidden" && !("result" in revokedReplay), "Revoked actor received a replayed command result.");
    const revokedClaim = await command.claimOutboxMessages({ worker: billingWorker });
    assert(!revokedClaim.some((message) => message.id === revokedOutbox.id), "Revoked delegated actor message was leased for delivery.");
    const rejectedOutbox = await db.outboxMessage.findUniqueOrThrow({ where: { id: revokedOutbox.id } });
    assert(rejectedOutbox.status === "dead_letter", "Revoked delegated actor message was not dead-lettered.");

    await db.facilityIdentitySequence.update({
      where: { entityType: "animal" },
      data: { nextValue: 10_000 },
    });
    try {
      await db.$transaction((tx) => command.allocateFacilityIdentifiers(tx, "animal" satisfies FacilityIdentifierType, 1));
      throw new Error("Exhausted facility identifier sequence unexpectedly allocated an ID.");
    } catch (error) {
      assert(error instanceof command.FacilityIdentifierExhaustedError, "Identifier exhaustion did not return the structured domain error.");
    }

    assert(await db.cageClosure.count() > 0, "Reviewed closure fixture was missing before destructive reseed verification.");
    process.env.ALLOW_DESTRUCTIVE_SEED = "true";
    const { seedDatabase } = await import("../prisma/seed-database");
    await seedDatabase({ clearAttachments: false });
    assert(await db.cageClosure.count() === 0, "Destructive reseeding retained a prior reviewed cage closure.");
    assert(await db.user.count() > 0, "Destructive reseeding did not restore the disposable demo fixture.");

    console.log(`Command, outbox, workflow, identifier, and migration exception verification passed in schema ${schema}.`);
    console.log("The verification schema is intentionally retained; this command never deletes database objects.");
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.endsWith("verify-command-foundation.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
