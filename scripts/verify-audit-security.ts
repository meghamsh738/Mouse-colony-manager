import { randomUUID } from "node:crypto";

import { Prisma, PrismaClient } from "@prisma/client";

import { getRecentAuditLogsView } from "../src/lib/settings-read";
import { writeSecurityEvent } from "../src/lib/security-event";
import { getTechnicalConsoleView } from "../src/lib/system-read";
import type { ResolvedActor } from "../src/lib/session";
import {
  assertRetainedVerificationTarget,
  assertSameRetainedVerificationTarget,
} from "./retained-verification-guard";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL;
if (!directDatabaseUrl) throw new Error("DIRECT_DATABASE_URL is required.");
assertRetainedVerificationTarget(databaseUrl);
const expectedTarget = assertSameRetainedVerificationTarget(databaseUrl, directDatabaseUrl);
const db = new PrismaClient({ datasourceUrl: databaseUrl });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectSqlRejected(
  label: string,
  expectedSqlState: string,
  expectedMessage: string,
  operation: () => Promise<unknown>,
) {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof Prisma.PrismaClientKnownRequestError, `${label} returned an unexpected error type.`);
    assert(error.code === "P2010", `${label} returned Prisma code ${error.code}, expected P2010.`);
    assert(error.meta?.code === expectedSqlState, `${label} returned SQLSTATE ${String(error.meta?.code)}, expected ${expectedSqlState}.`);
    assert(String(error.meta?.message).includes(expectedMessage), `${label} did not return the expected database rejection message.`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

async function expectCapabilityRejected(label: string, operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof Error && error.message.includes("unavailable"), `${label} returned an unexpected capability error.`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

function actor(input: { id: string; role: "facility_admin" | "it_head" }): ResolvedActor {
  return {
    id: input.id,
    email: `${input.role}@audit-verifier.test`,
    name: input.role,
    role: input.role,
    databaseRole: input.role,
    canonicalRole: input.role,
    authzVersion: 1,
    activeLabId: null,
    activeMembership: null,
    memberships: [],
    capabilities: [],
  };
}

async function main() {
  const [liveTarget] = await db.$queryRaw<Array<{ database: string; schema: string }>>(
    Prisma.sql`SELECT current_database() AS database, current_schema() AS schema`,
  );
  assert(liveTarget?.database === expectedTarget.database, "Prisma connected to a different database than the guarded DATABASE_URL.");
  assert(liveTarget.schema === expectedTarget.schema, "Prisma connected to a different schema than the guarded DATABASE_URL.");

  const runMutationProbes = process.env.AUDIT_SECURITY_MUTATION_PROBES !== "skip";
  const suffix = randomUUID();
  const facilityAdminId = `audit-admin-${suffix}`;
  const itHeadId = `audit-it-${suffix}`;
  const labId = `audit-lab-${suffix}`;
  const receiptId = `audit-receipt-${suffix}`;
  const requestId = `audit-request-${suffix}`;
  const otherLabId = `audit-other-lab-${suffix}`;

  await db.user.createMany({
    data: [
      { id: facilityAdminId, name: "Audit verifier admin", email: `admin-${suffix}@audit.test`, passwordHash: "not-used", role: "facility_admin" },
      { id: itHeadId, name: "Audit verifier IT", email: `it-${suffix}@audit.test`, passwordHash: "not-used", role: "it_head" },
    ],
  });
  await db.lab.createMany({ data: [
    { id: labId, name: "Audit verifier lab", code: `AUD-${suffix.slice(0, 8)}` },
    { id: otherLabId, name: "Audit verifier other lab", code: `AUO-${suffix.slice(0, 8)}` },
  ] });
  const requestHash = suffix.replaceAll("-", "");
  const setAuditContext = async (tx: Prisma.TransactionClient, input: {
    id: string;
    actorId?: string;
    commandType?: string;
    requestHash?: string;
  }) => tx.$queryRaw(Prisma.sql`
    SELECT
      set_config('mcm.audit_receipt_id', ${input.id}, true),
      set_config('mcm.audit_actor_id', ${input.actorId ?? facilityAdminId}, true),
      set_config('mcm.audit_command_type', ${input.commandType ?? "audit.verification"}, true),
      set_config('mcm.audit_request_hash', ${input.requestHash ?? requestHash}, true)
  `);
  const createCurrentReceipt = (tx: Prisma.TransactionClient, input: {
    id: string;
    labId?: string;
    status?: "processing" | "failed";
  }) => tx.commandReceipt.create({
    data: {
      id: input.id,
      actorId: facilityAdminId,
      actorAuthzVersion: 1,
      labId: input.labId ?? labId,
      commandType: "audit.verification",
      idempotencyKey: input.id,
      requestHash,
      requestId,
      status: input.status ?? "processing",
      aggregateType: "verification_record",
      aggregateId: suffix,
      startedAt: new Date(),
      ...(input.status === "failed" ? { completedAt: new Date(), errorCode: "test_failure" } : {}),
    },
  });

  const audit = await db.$transaction(async (tx) => {
    await createCurrentReceipt(tx, { id: receiptId });
    await setAuditContext(tx, { id: receiptId });
    return tx.auditLog.create({
      data: {
        id: `audit-${suffix}`,
        actorId: facilityAdminId,
        actorRole: "spoofed",
        entityType: "verification_record",
        entityId: suffix,
        action: "verify_context",
        newValue: { receiptId: "display-only-not-provenance" },
        timestamp: new Date(),
      },
    });
  });
  assert(audit.actorRole === "facility_admin", "Operational audit actor role was not database-stamped.");
  assert(audit.labId === labId, "Operational audit lab context was not derived from the command receipt.");
  assert(audit.commandReceiptId === receiptId, "Operational audit was not bound to its trusted command receipt relation.");
  assert(audit.requestId === requestId, "Operational audit request context was not derived from the command receipt.");
  assert(audit.commandType === "audit.verification", "Operational audit command type was not database-stamped.");
  assert(audit.commandAggregateType === "verification_record" && audit.commandAggregateId === suffix,
    "Operational audit command aggregate was not database-stamped.");

  const security = await writeSecurityEvent(db, {
    eventType: "verification.security.succeeded",
    outcome: "succeeded",
    actorId: itHeadId,
    scopeLabId: labId,
    correlationId: requestId,
    subjectType: "verification_record",
    subjectId: suffix,
    source: "audit_verifier",
    summary: "Security ledger verification succeeded.",
  });
  assert(security.actorRole === "it_head", "Security event actor role was not database-stamped.");
  assert(security.scopeLabId === labId, "Security event scope correlation was not retained.");
  assert(security.correlationId === requestId, "Security event correlation identifier was not retained.");

  const auditCountBefore = await db.auditLog.count();
  const securityCountBefore = await db.securityEvent.count();
  if (runMutationProbes) {
    await expectSqlRejected("operational audit update", "55000", "Operational audit history is append-only", () => db.$executeRaw(
      Prisma.sql`UPDATE "AuditLog" SET "action" = 'mutated' WHERE id = ${audit.id}`,
    ));
    await expectSqlRejected("operational audit delete", "55000", "Operational audit history is append-only", () => db.$executeRaw(
      Prisma.sql`DELETE FROM "AuditLog" WHERE id = ${audit.id}`,
    ));
    await expectSqlRejected("operational audit truncate", "55000", "Operational audit history is append-only", () => db.$executeRawUnsafe('TRUNCATE TABLE "AuditLog"'));
    await expectSqlRejected("security event update", "55000", "Security event history is append-only", () => db.$executeRaw(
      Prisma.sql`UPDATE "SecurityEvent" SET summary = 'Mutated.' WHERE id = ${security.id}`,
    ));
    await expectSqlRejected("security event delete", "55000", "Security event history is append-only", () => db.$executeRaw(
      Prisma.sql`DELETE FROM "SecurityEvent" WHERE id = ${security.id}`,
    ));
    await expectSqlRejected("security event truncate", "55000", "Security event history is append-only", () => db.$executeRawUnsafe('TRUNCATE TABLE "SecurityEvent"'));
  }
  await expectSqlRejected("malformed security event", "23514", "SecurityEvent_eventType_check", () => db.$executeRaw(
    Prisma.sql`INSERT INTO "SecurityEvent" (id, "eventType", outcome, source, summary)
      VALUES (${`malformed-${suffix}`}, 'bad type', 'failed', 'verifier', 'Malformed event.')`,
  ));
  const oldReceiptId = `audit-old-receipt-${suffix}`;
  await db.commandReceipt.create({
    data: {
      id: oldReceiptId, actorId: facilityAdminId, actorAuthzVersion: 1, labId: otherLabId,
      commandType: "audit.verification", idempotencyKey: oldReceiptId, requestHash, requestId,
      status: "processing", aggregateType: "verification_record", aggregateId: suffix, startedAt: new Date(),
    },
  });
  await expectSqlRejected("same-actor old cross-lab receipt graft", "23514", "Audit command context is not current", () => db.$transaction(async (tx) => {
    await setAuditContext(tx, { id: oldReceiptId });
    return tx.$executeRaw(Prisma.sql`INSERT INTO "AuditLog" (id, "actorId", "entityType", "entityId", action, timestamp)
      VALUES (${`old-receipt-${suffix}`}, ${facilityAdminId}, 'verification_record', ${suffix}, 'old_receipt', CURRENT_TIMESTAMP)`);
  }));
  await expectSqlRejected("failed receipt graft", "23514", "Audit command context is not current", () => db.$transaction(async (tx) => {
    const failedReceiptId = `audit-failed-receipt-${suffix}`;
    await createCurrentReceipt(tx, { id: failedReceiptId, status: "failed" });
    await setAuditContext(tx, { id: failedReceiptId });
    return tx.$executeRaw(Prisma.sql`INSERT INTO "AuditLog" (id, "actorId", "entityType", "entityId", action, timestamp)
      VALUES (${`failed-receipt-${suffix}`}, ${facilityAdminId}, 'verification_record', ${suffix}, 'failed_receipt', CURRENT_TIMESTAMP)`);
  }));
  await expectSqlRejected("wrong command receipt graft", "23514", "Audit command context is not current", () => db.$transaction(async (tx) => {
    const wrongCommandReceiptId = `audit-wrong-command-${suffix}`;
    await createCurrentReceipt(tx, { id: wrongCommandReceiptId });
    await setAuditContext(tx, { id: wrongCommandReceiptId, commandType: "audit.unrelated" });
    return tx.$executeRaw(Prisma.sql`INSERT INTO "AuditLog" (id, "actorId", "entityType", "entityId", action, timestamp)
      VALUES (${`wrong-command-${suffix}`}, ${facilityAdminId}, 'verification_record', ${suffix}, 'wrong_command', CURRENT_TIMESTAMP)`);
  }));
  await expectSqlRejected("wrong request hash receipt graft", "23514", "Audit command context is not current", () => db.$transaction(async (tx) => {
    const wrongHashReceiptId = `audit-wrong-hash-${suffix}`;
    await createCurrentReceipt(tx, { id: wrongHashReceiptId });
    await setAuditContext(tx, { id: wrongHashReceiptId, requestHash: "0".repeat(32) });
    return tx.$executeRaw(Prisma.sql`INSERT INTO "AuditLog" (id, "actorId", "entityType", "entityId", action, timestamp)
      VALUES (${`wrong-hash-${suffix}`}, ${facilityAdminId}, 'verification_record', ${suffix}, 'wrong_hash', CURRENT_TIMESTAMP)`);
  }));
  await expectSqlRejected("unreceipted receipt relation", "23514", "Unreceipted audit command, lab, and request context is not authoritative", () => db.$executeRaw(
    Prisma.sql`INSERT INTO "AuditLog" (id, "actorId", "commandReceiptId", "entityType", "entityId", action, timestamp)
      VALUES (${`unreceipted-relation-${suffix}`}, ${facilityAdminId}, ${receiptId}, 'verification_record', ${suffix}, 'unreceipted_relation', CURRENT_TIMESTAMP)`,
  ));
  await expectSqlRejected("unreceipted request provenance", "23514", "Unreceipted audit command, lab, and request context is not authoritative", () => db.$executeRaw(
    Prisma.sql`INSERT INTO "AuditLog" (id, "actorId", "requestId", "entityType", "entityId", action, timestamp)
      VALUES (${`unreceipted-request-${suffix}`}, ${facilityAdminId}, 'caller-controlled-request', 'verification_record', ${suffix}, 'unreceipted_request', CURRENT_TIMESTAMP)`,
  ));
  await expectSqlRejected("unreceipted lab provenance", "23514", "Unreceipted audit command, lab, and request context is not authoritative", () => db.$executeRaw(
    Prisma.sql`INSERT INTO "AuditLog" (id, "actorId", "labId", "entityType", "entityId", action, timestamp)
      VALUES (${`unreceipted-lab-${suffix}`}, ${facilityAdminId}, ${labId}, 'verification_record', ${suffix}, 'unreceipted_lab', CURRENT_TIMESTAMP)`,
  ));

  const [auditAfter, securityAfter, auditCountAfter, securityCountAfter] = await Promise.all([
    db.auditLog.findUnique({ where: { id: audit.id }, select: { action: true } }),
    db.securityEvent.findUnique({ where: { id: security.id }, select: { summary: true } }),
    db.auditLog.count(),
    db.securityEvent.count(),
  ]);
  assert(auditAfter?.action === audit.action, "Rejected operational ledger mutations changed the retained row.");
  assert(securityAfter?.summary === security.summary, "Rejected security ledger mutations changed the retained row.");
  assert(auditCountAfter === auditCountBefore, "Rejected operational ledger mutations changed the row count.");
  assert(securityCountAfter === securityCountBefore, "Rejected security ledger mutations changed the row count.");

  const operationalView = await getRecentAuditLogsView(actor({ id: facilityAdminId, role: "facility_admin" }), 100);
  const technicalView = await getTechnicalConsoleView(actor({ id: itHeadId, role: "it_head" }), 100);
  const [legacyIdentityAuditCount, legacySecurityCount] = await Promise.all([
    db.auditLog.count({ where: { entityType: { in: ["user_invitation", "user_role", "user_access"] } } }),
    db.securityEvent.count({ where: { source: "legacy_audit_backfill" } }),
  ]);
  assert(operationalView.some((entry) => entry.id === audit.id), "Facility Admin operational projection omitted the audit entry.");
  assert(!operationalView.some((entry) => ["user_invitation", "user_role", "user_access"].includes(entry.entityType)), "Facility Admin projection exposed identity-security history.");
  assert(technicalView.securityEvents.some((entry) => entry.id === security.id), "IT security projection omitted the event.");
  assert(legacySecurityCount === legacyIdentityAuditCount, "Legacy identity audits were not completely copied into the security ledger.");
  assert(!("previousValue" in operationalView[0]) && !("newValue" in operationalView[0]), "Operational projection exposed domain JSON.");
  assert(!("payload" in technicalView), "Technical projection exposed an outbox payload.");
  await expectCapabilityRejected("IT domain projection", () => getRecentAuditLogsView(actor({ id: itHeadId, role: "it_head" })));
  await expectCapabilityRejected("Facility security projection", () => getTechnicalConsoleView(actor({ id: facilityAdminId, role: "facility_admin" })));

  console.log(JSON.stringify({
    auditId: audit.id,
    securityEventId: security.id,
    actorRole: audit.actorRole,
    labId: audit.labId,
    requestId: audit.requestId,
    commandReceiptId: audit.commandReceiptId,
    commandType: audit.commandType,
    appendOnly: runMutationProbes ? true : "mutation probes skipped by execution policy",
    projectionsSeparated: true,
    legacyIdentityBackfill: `${legacySecurityCount}/${legacyIdentityAuditCount}`,
  }, null, 2));
}

main()
  .finally(async () => db.$disconnect());
