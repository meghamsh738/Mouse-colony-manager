import { randomUUID } from "node:crypto";

import { Prisma, PrismaClient } from "@prisma/client";

import { getInvoiceDetailView } from "../src/lib/billing-read";
import {
  addInvoiceAdjustment,
  finalizeInvoice,
  generateLabInvoice,
  upsertCageChargeCategory,
  voidInvoice,
} from "../src/lib/billing-write";
import { allocateFacilityIdentifiers } from "../src/lib/command-foundation";
import { getActorCapabilities } from "../src/lib/capabilities";
import { startReplacementChargePeriod } from "../src/lib/colony-write";
import type { ResolvedActor } from "../src/lib/session";
import { assertRetainedVerificationTarget } from "./retained-verification-guard";

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${process.pid}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectRejected(label: string, operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(`${label} was expected to be rejected.`);
}

function facilityAdminActor(): ResolvedActor {
  return {
    id: "user-admin",
    email: "admin@colony.local",
    name: "Main overall",
    role: "admin",
    databaseRole: "facility_admin",
    canonicalRole: "facility_admin",
    authzVersion: 1,
    activeLabId: null,
    activeMembership: null,
    memberships: [],
    capabilities: [...getActorCapabilities({ canonicalRole: "facility_admin", activeMembership: null })],
  };
}

function labActor(input: { id: string; email: string; labId: string; labName: string; labCode: string }): ResolvedActor {
  const membership = { labId: input.labId, labName: input.labName, labCode: input.labCode, role: "manager" as const };
  return {
    id: input.id,
    email: input.email,
    name: "Billing verifier lab user",
    role: "animal_staff",
    databaseRole: "lab_user",
    canonicalRole: "lab_user",
    authzVersion: 1,
    activeLabId: input.labId,
    activeMembership: membership,
    memberships: [membership],
    capabilities: [...getActorCapabilities({ canonicalRole: "lab_user", activeMembership: membership })],
  };
}

async function createCageWithPeriod(input: {
  labId: string;
  barcode: string;
  cageNumber: string;
  categoryId: string;
  startedAt: Date;
  endedAt?: Date;
  rateCents: number;
}) {
  return prisma.$transaction(async (tx) => {
    const [facilityCageId] = await allocateFacilityIdentifiers(tx, "cage", 1);
    const cageId = `billing-cage-${suffix}-${input.cageNumber}`;
    const periodId = `billing-period-${suffix}-${input.cageNumber}`;
    await tx.cage.create({
      data: {
        id: cageId,
        facilityCageId,
        labId: input.labId,
        roomId: "room-default",
        rackId: "rack-default",
        cageNumber: input.cageNumber,
        barcode: input.barcode,
        status: "active",
      },
    });
    await tx.cageChargePeriod.create({
      data: {
        id: periodId,
        cageId,
        labId: input.labId,
        categoryId: input.categoryId,
        dailyRateCents: input.rateCents,
        currencyCode: "USD",
        startedAt: input.startedAt,
        endedAt: input.endedAt,
      },
    });
    return { cageId, periodId, facilityCageId };
  });
}

async function verifyMigrationWriterLock(categoryId: string) {
  const lockClient = new PrismaClient();
  const writerClient = new PrismaClient();
  let signalLocked: (() => void) | undefined;
  let releaseLock: (() => void) | undefined;
  const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
  const released = new Promise<void>((resolve) => { releaseLock = resolve; });
  const holding = lockClient.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'LOCK TABLE "Invoice", "InvoiceLineItem", "CageChargePeriod", "CageChargeCategory" IN SHARE ROW EXCLUSIVE MODE',
    );
    signalLocked?.();
    await released;
  }, { timeout: 5_000, maxWait: 5_000 });

  await locked;
  try {
    await expectRejected("migration preflight writer race", () => writerClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '250ms'");
      await tx.$executeRaw(Prisma.sql`
        UPDATE "CageChargeCategory"
        SET name = name
        WHERE id = ${categoryId}
      `);
    }, { timeout: 2_000, maxWait: 2_000 }));
  } finally {
    releaseLock?.();
    await holding;
    await Promise.all([lockClient.$disconnect(), writerClient.$disconnect()]);
  }
}

async function ensureVerifierInfrastructure() {
  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: "user-admin" },
      update: {},
      create: {
        id: "user-admin",
        name: "Billing verifier facility admin",
        email: "admin@colony.local",
        passwordHash: "billing-verifier-only",
        role: "facility_admin",
      },
    });
    await tx.user.upsert({
      where: { id: "user-lab-1" },
      update: {},
      create: {
        id: "user-lab-1",
        name: "Billing verifier template lab user",
        email: "lab1.user@colony.local",
        passwordHash: "billing-verifier-only",
        role: "lab_user",
      },
    });
    await tx.facility.upsert({
      where: { id: "facility-default" },
      update: {},
      create: {
        id: "facility-default",
        name: "Billing verifier facility",
        cageBarcodePrefix: "MC",
        maxCageOccupancy: 6,
      },
    });
    await tx.room.upsert({
      where: { id: "room-default" },
      update: {},
      create: { id: "room-default", facilityId: "facility-default", roomNumber: "ROOM-1" },
    });
    await tx.rack.upsert({
      where: { id: "rack-default" },
      update: {},
      create: { id: "rack-default", roomId: "room-default", rackNumber: "R1" },
    });
    await tx.facilityIdentitySequence.upsert({
      where: { entityType: "cage" },
      update: {},
      create: { entityType: "cage", nextValue: 1000, minimumValue: 1000, maximumValue: 9999, width: 4 },
    });
  });
}

async function main() {
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");
  assertRetainedVerificationTarget(databaseUrl);
  await ensureVerifierInfrastructure();

  const admin = facilityAdminActor();
  const labOneId = `billing-lab-one-${suffix}`;
  const labTwoId = `billing-lab-two-${suffix}`;
  const labOneUserId = `billing-lab-one-user-${suffix}`;
  const labTwoUserId = `billing-lab-two-user-${suffix}`;
  const secondLabMemberId = `billing-member-${suffix}`;
  const existingPassword = await prisma.user.findUniqueOrThrow({
    where: { id: "user-lab-1" },
    select: { passwordHash: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.lab.createMany({
      data: [
        { id: labOneId, name: `Billing Lab One ${suffix}`, code: `BL1_${suffix}`.replaceAll(/[^A-Z0-9_]/gi, "_").slice(0, 40) },
        { id: labTwoId, name: `Billing Lab Two ${suffix}`, code: `BL2_${suffix}`.replaceAll(/[^A-Z0-9_]/gi, "_").slice(0, 40) },
      ],
    });
    await tx.user.createMany({
      data: [
        {
          id: labOneUserId,
          name: "Billing verifier Lab One user",
          email: `billing-one-${suffix}@example.test`,
          passwordHash: existingPassword.passwordHash,
          role: "lab_user",
        },
        {
          id: labTwoUserId,
          name: "Billing verifier Lab Two user",
          email: `billing-two-${suffix}@example.test`,
          passwordHash: existingPassword.passwordHash,
          role: "lab_user",
        },
        {
          id: secondLabMemberId,
          name: "Billing verifier second member",
          email: `billing-member-${suffix}@example.test`,
          passwordHash: existingPassword.passwordHash,
          role: "lab_user",
        },
      ],
    });
    await tx.labMembership.createMany({
      data: [
        { id: `billing-membership-one-${suffix}`, labId: labOneId, userId: labOneUserId, role: "manager" },
        { id: `billing-membership-two-${suffix}`, labId: labTwoId, userId: labTwoUserId, role: "manager" },
        { id: `billing-membership-second-${suffix}`, labId: labOneId, userId: secondLabMemberId, role: "viewer" },
      ],
    });
  });
  const labOne = labActor({
    id: labOneUserId,
    email: `billing-one-${suffix}@example.test`,
    labId: labOneId,
    labName: `Billing Lab One ${suffix}`,
    labCode: `BL1_${suffix}`.replaceAll(/[^A-Z0-9_]/gi, "_").slice(0, 40),
  });
  const labTwo = labActor({
    id: labTwoUserId,
    email: `billing-two-${suffix}@example.test`,
    labId: labTwoId,
    labName: `Billing Lab Two ${suffix}`,
    labCode: `BL2_${suffix}`.replaceAll(/[^A-Z0-9_]/gi, "_").slice(0, 40),
  });
  const categoryId = `billing-category-${suffix}`;
  await prisma.cageChargeCategory.create({
    data: {
      id: categoryId,
      name: "Billing verifier standard",
      code: `BILL_${suffix}`.replaceAll(/[^A-Z0-9_]/gi, "_").slice(0, 38),
      dailyRateCents: 250,
      currencyCode: "USD",
    },
  });
  await verifyMigrationWriterLock(categoryId);
  const invalidCurrency = await upsertCageChargeCategory({
    expectedVersion: 0,
    name: "Invalid currency category",
    code: `BAD_${suffix}`.replaceAll(/[^A-Z0-9_]/gi, "_").slice(0, 38),
    dailyRateCents: 100,
    currencyCode: "ZZZ",
    active: true,
    idempotencyKey: `billing-invalid-currency-${suffix}`,
    requestId: `billing-invalid-currency-request-${suffix}`,
  }, admin);
  assert(!invalidCurrency.ok && invalidCurrency.message.includes("supported ISO currency"), "An invalid ISO currency reached billing storage.");
  await expectRejected("invalid category currency database insert", () => prisma.cageChargeCategory.create({
    data: {
      id: `invalid-currency-category-${suffix}`,
      name: "Invalid raw currency",
      code: `RAW_BAD_${suffix}`.replaceAll(/[^A-Z0-9_]/gi, "_").slice(0, 38),
      dailyRateCents: 100,
      currencyCode: "ZZZ",
    },
  }));

  const primary = await createCageWithPeriod({
    labId: labOneId,
    barcode: `BILL-A-${suffix}`,
    cageNumber: `B${String(process.pid).slice(-3)}`,
    categoryId,
    startedAt: new Date("2026-06-01T00:00:00.000Z"),
    rateCents: 250,
  });
  await prisma.$transaction((tx) => startReplacementChargePeriod(tx, {
    cageId: primary.cageId,
    labId: labOneId,
    categoryId,
    dailyRateCents: 300,
    timestamp: new Date("2026-06-03T00:00:00.000Z"),
    notes: "Verifier rate boundary.",
  }));
  await expectRejected("same-day replacement charge period", () => prisma.$transaction((tx) => startReplacementChargePeriod(tx, {
    cageId: primary.cageId,
    labId: labOneId,
    categoryId,
    dailyRateCents: 325,
    timestamp: new Date("2026-06-03T00:00:00.000Z"),
    notes: "Must not create a zero-day period.",
  })));
  const boundedPeriods = await prisma.cageChargePeriod.findMany({
    where: { cageId: primary.cageId },
    orderBy: { startedAt: "asc" },
  });
  assert(
    boundedPeriods.length === 2
    && boundedPeriods[0]?.endedAt?.toISOString() === "2026-06-03T00:00:00.000Z"
    && boundedPeriods[1]?.startedAt.toISOString() === "2026-06-03T00:00:00.000Z",
    "Rate replacement did not preserve an exact UTC service-day boundary.",
  );
  const draft = await generateLabInvoice({
    labId: labOneId,
    periodStart: "2026-06-01",
    periodEnd: "2026-06-05",
    idempotencyKey: `billing-generate-${suffix}`,
    requestId: `billing-generate-request-${suffix}`,
  }, admin);
  assert(draft.ok && draft.entityId, `Draft generation failed: ${draft.message}`);
  const draftId = draft.entityId;
  const firstDraft = await prisma.invoice.findUniqueOrThrow({ where: { id: draftId } });
  assert(firstDraft.subtotalCents === 1100 && firstDraft.totalCents === 1100, "Rate-boundary invoice total was incorrect.");

  const debit = await addInvoiceAdjustment({
    invoiceId: draftId,
    labId: labOneId,
    expectedVersion: firstDraft.version,
    adjustmentType: "debit",
    amountCents: 125,
    reason: "Verified special handling debit.",
    idempotencyKey: `billing-debit-${suffix}`,
    requestId: `billing-debit-request-${suffix}`,
  }, admin);
  assert(debit.ok && debit.version === firstDraft.version + 1, `Debit failed: ${debit.message}`);
  const credit = await addInvoiceAdjustment({
    invoiceId: draftId,
    labId: labOneId,
    expectedVersion: debit.version,
    adjustmentType: "credit",
    amountCents: 25,
    reason: "Verified service credit.",
    idempotencyKey: `billing-credit-${suffix}`,
    requestId: `billing-credit-request-${suffix}`,
  }, admin);
  assert(credit.ok && credit.version === debit.version + 1, `Credit failed: ${credit.message}`);

  const adjusted = await prisma.invoice.findUniqueOrThrow({ where: { id: draftId } });
  assert(
    adjusted.adjustmentTotalCents === 100 && adjusted.totalCents === 1200,
    "Append-only adjustment total did not equal debit minus credit.",
  );
  const mismatchedLabFinalization = await finalizeInvoice({
    invoiceId: draftId,
    labId: labTwoId,
    expectedVersion: adjusted.version,
    idempotencyKey: `billing-finalize-wrong-lab-${suffix}`,
    requestId: `billing-finalize-wrong-lab-request-${suffix}`,
  }, admin);
  assert(!mismatchedLabFinalization.ok, "An invoice was finalized through a mismatched submitted lab.");
  assert(await prisma.notificationEvent.count({
    where: { entityType: "invoice", entityId: draftId, categoryKey: "invoice" },
  }) === 0, "A rejected mismatched-lab finalization emitted a notification.");
  const finalized = await finalizeInvoice({
    invoiceId: draftId,
    labId: labOneId,
    expectedVersion: adjusted.version,
    idempotencyKey: `billing-finalize-${suffix}`,
    requestId: `billing-finalize-request-${suffix}`,
  }, admin);
  assert(finalized.ok, `Finalization failed: ${finalized.message}`);
  const issued = await prisma.invoice.findUniqueOrThrow({ where: { id: draftId } });
  assert(/^INV-\d{4}-\d{6,}$/.test(issued.finalNumber ?? ""), "Final invoice number did not use the immutable facility sequence.");
  assert(issued.version === adjusted.version + 1, "Finalization did not advance invoice version.");

  const invoiceRecipients = await prisma.notificationRecipient.findMany({
    where: {
      event: {
        entityType: "invoice",
        entityId: draftId,
        categoryKey: "invoice",
        sourceKey: { endsWith: `invoice_finalized:${draftId}` },
      },
      status: "active",
    },
    select: { userId: true },
    orderBy: { userId: "asc" },
  });
  const expectedFinalizationRecipients = [secondLabMemberId, labOneUserId].sort();
  assert(
    invoiceRecipients.map((recipient) => recipient.userId).join(",") === expectedFinalizationRecipients.join(","),
    `Invoice recipient scope leaked beyond active lab members: ${invoiceRecipients.map((recipient) => recipient.userId).join(",")}`,
  );
  assert((await getInvoiceDetailView(draftId, labOne))?.totalCents === 1200, "Owning lab could not read the governed total.");
  assert(await getInvoiceDetailView(draftId, labTwo) === null, "Foreign lab read an invoice by direct ID.");

  const renamedRate = await upsertCageChargeCategory({
    categoryId,
    expectedVersion: 1,
    name: "Renamed live billing rate",
    code: `BILL_${suffix}`.replaceAll(/[^A-Z0-9_]/gi, "_").slice(0, 38),
    dailyRateCents: 275,
    currencyCode: "USD",
    active: true,
    notes: "Renamed after invoice finalization.",
    idempotencyKey: `billing-rate-rename-${suffix}`,
    requestId: `billing-rate-rename-request-${suffix}`,
  }, admin);
  assert(renamedRate.ok && renamedRate.version === 2, `Versioned rate update failed: ${renamedRate.message}`);
  const rateReceipt = await prisma.commandReceipt.findUniqueOrThrow({
    where: {
      actorId_commandType_idempotencyKey: {
        actorId: admin.id,
        commandType: "billing.rate.upsert",
        idempotencyKey: `billing-rate-rename-${suffix}`,
      },
    },
  });
  assert(
    rateReceipt.aggregateType === "cage_charge_category"
    && rateReceipt.aggregateId === categoryId
    && rateReceipt.expectedVersion === 1
    && rateReceipt.resultingVersion === 2,
    "The cage-rate command receipt did not preserve its aggregate and optimistic versions.",
  );
  const staleRate = await upsertCageChargeCategory({
    categoryId,
    expectedVersion: 1,
    name: "Stale overwrite",
    code: `BILL_${suffix}`.replaceAll(/[^A-Z0-9_]/gi, "_").slice(0, 38),
    dailyRateCents: 280,
    currencyCode: "USD",
    active: true,
    idempotencyKey: `billing-rate-stale-${suffix}`,
    requestId: `billing-rate-stale-request-${suffix}`,
  }, admin);
  assert(!staleRate.ok && staleRate.message.includes("changed"), "A stale cage-rate edit overwrote a newer version.");
  const terminalDetail = await getInvoiceDetailView(draftId, admin);
  assert(
    terminalDetail?.lineItems.every((line) => line.categoryName.startsWith("Billing verifier standard [")) === true,
    "Terminal invoice category snapshot changed after the live rate was renamed.",
  );

  const adjustmentId = (await prisma.invoiceAdjustment.findFirstOrThrow({ where: { invoiceId: draftId } })).id;
  await expectRejected("terminal adjustment insert", () => prisma.invoiceAdjustment.create({
    data: {
      id: randomUUID(),
      invoiceId: draftId,
      labId: labOneId,
      adjustmentType: "debit",
      amountCents: 1,
      reason: "Must fail",
      createdById: admin.id,
    },
  }));
  await expectRejected("adjustment update", () => prisma.invoiceAdjustment.update({
    where: { id: adjustmentId },
    data: { reason: "Mutation must fail" },
  }));
  await expectRejected("adjustment delete", () => prisma.invoiceAdjustment.delete({ where: { id: adjustmentId } }));
  const activePeriod = await prisma.cageChargePeriod.findFirstOrThrow({
    where: { cageId: primary.cageId, endedAt: null },
  });
  await prisma.cageChargePeriod.update({
    where: { id: activePeriod.id },
    data: { endedAt: new Date("2026-06-10T00:00:00.000Z") },
  });
  await expectRejected("closed charge period mutation", () => prisma.cageChargePeriod.update({
    where: { id: activePeriod.id },
    data: { endedAt: new Date("2026-06-11T00:00:00.000Z") },
  }));
  await expectRejected("charge period delete", () => prisma.cageChargePeriod.delete({ where: { id: activePeriod.id } }));
  await expectRejected("final number mutation", () => prisma.invoice.update({
    where: { id: draftId },
    data: { finalNumber: "INV-2099-999999" },
  }));

  await prisma.labMembership.update({
    where: { labId_userId: { labId: labOneId, userId: secondLabMemberId } },
    data: { active: false },
  });
  const voided = await voidInvoice({
    invoiceId: draftId,
    labId: labOneId,
    expectedVersion: issued.version,
    reason: "Verifier void preserving immutable history.",
    idempotencyKey: `billing-void-${suffix}`,
    requestId: `billing-void-request-${suffix}`,
  }, admin);
  assert(voided.ok, `Void failed: ${voided.message}`);
  assert(await prisma.notificationEvent.count({
    where: { entityType: "invoice", entityId: draftId, categoryKey: "invoice" },
  }) === 2, "Finalization and void did not create distinct lab invoice events.");
  const voidRecipients = await prisma.notificationRecipient.findMany({
    where: {
      event: {
        entityType: "invoice",
        entityId: draftId,
        categoryKey: "invoice",
        sourceKey: { endsWith: `invoice_voided:${draftId}` },
      },
      status: "active",
    },
    select: { userId: true },
  });
  assert(
    voidRecipients.map((recipient) => recipient.userId).join(",") === labOneUserId,
    "A deactivated lab member received a later invoice event.",
  );

  await expectRejected("fractional charge-period insert", () => createCageWithPeriod({
    labId: labTwoId,
    barcode: `BILL-B-${suffix}`,
    cageNumber: `C${String(process.pid).slice(-3)}`,
    categoryId,
    startedAt: new Date("2026-06-01T12:00:00.000Z"),
    rateCents: 250,
  }));
  await expectRejected("zero-length charge-period insert", () => createCageWithPeriod({
    labId: labTwoId,
    barcode: `BILL-ZERO-${suffix}`,
    cageNumber: `Z${String(process.pid).slice(-3)}`,
    categoryId,
    startedAt: new Date("2026-06-01T00:00:00.000Z"),
    endedAt: new Date("2026-06-01T00:00:00.000Z"),
    rateCents: 250,
  }));
  const secondary = await createCageWithPeriod({
    labId: labTwoId,
    barcode: `BILL-B-${suffix}`,
    cageNumber: `C${String(process.pid).slice(-3)}`,
    categoryId,
    startedAt: new Date("2026-06-01T00:00:00.000Z"),
    rateCents: 250,
  });

  console.log(JSON.stringify({
    draftId,
    finalNumber: issued.finalNumber,
    subtotalCents: issued.subtotalCents,
    adjustmentTotalCents: issued.adjustmentTotalCents,
    totalCents: issued.totalCents,
    invoiceRecipients: invoiceRecipients.map((recipient) => recipient.userId),
    voidRecipients: voidRecipients.map((recipient) => recipient.userId),
    rateBoundaryPeriods: boundedPeriods.length,
    staleRateRejected: true,
    rateReceiptVersions: { expected: rateReceipt.expectedVersion, resulting: rateReceipt.resultingVersion },
    terminalCategorySnapshotProtected: true,
    migrationWriterLockVerified: true,
    fractionalPeriodRejected: true,
    zeroLengthPeriodRejected: true,
    secondaryPeriodId: secondary.periodId,
    invalidCurrencyRejected: true,
    chargePeriodAppendOnly: true,
    adjustmentHistoryProtected: true,
    foreignLabRejected: true,
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
