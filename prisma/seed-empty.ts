import { Prisma, PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/password";
import { assertEmptyBootstrapAllowed } from "../src/lib/destructive-seed-guard";
import { EMPTY_LABS, EMPTY_PROFILES } from "../src/lib/empty-profile-config";
import { seedDutyQaFixture } from "./seed-duty-qa";

const prisma = new PrismaClient();

const rules: Prisma.RuleConfigCreateInput[] = [
  {
    id: "rule-breeder-min-age",
    key: "breeder_min_age_days",
    label: "Breeder minimum age",
    category: "breeding",
    valueType: "number",
    value: 56,
    description: "Warn if a breeder is too young.",
    criticalBlock: true,
  },
  {
    id: "rule-breeder-max-age",
    key: "breeder_max_age_days",
    label: "Breeder maximum age",
    category: "breeding",
    valueType: "number",
    value: 270,
    description: "Warn if a breeder is beyond the preferred age window.",
  },
  {
    id: "rule-breeding-duration",
    key: "breeding_duration_max_days",
    label: "Maximum breeding duration",
    category: "breeding",
    valueType: "number",
    value: 180,
    description: "Warn if active breedings run too long.",
  },
  {
    id: "rule-weaning-due",
    key: "weaning_due_days",
    label: "Weaning due age",
    category: "compliance",
    valueType: "number",
    value: 21,
    description: "Remind when litters reach the expected weaning age.",
  },
  {
    id: "rule-genotype-pending",
    key: "genotype_pending_days",
    label: "Pending genotype threshold",
    category: "genotype",
    valueType: "number",
    value: 14,
    description: "Warn if genotype confirmation is overdue.",
  },
  {
    id: "rule-cage-capacity",
    key: "cage_max_occupancy",
    label: "Maximum cage occupancy",
    category: "capacity",
    valueType: "number",
    value: 6,
    description: "Block assignments beyond facility capacity.",
    criticalBlock: true,
  },
  {
    id: "rule-mixed-sex",
    key: "mixed_sex_holding_allowed",
    label: "Allow mixed-sex holding",
    category: "capacity",
    valueType: "boolean",
    value: false,
    description: "If false, non-breeding cages with mixed sex raise alerts.",
    criticalBlock: true,
  },
  {
    id: "rule-reservation-grace",
    key: "reservation_start_grace_days",
    label: "Reserved experiment grace period",
    category: "experiment",
    valueType: "number",
    value: 10,
    description: "Warn when reserved animals are not started promptly.",
  },
  {
    id: "rule-project-assignment",
    key: "project_assignment_required_days",
    label: "Project assignment threshold",
    category: "compliance",
    valueType: "number",
    value: 84,
    description: "Warn when older holding animals still lack project allocation.",
  },
  {
    id: "rule-notify-genotype",
    key: "notify_in_app_genotype_pending",
    label: "In-app overdue genotype notifications",
    category: "genotype",
    valueType: "boolean",
    value: true,
  },
  {
    id: "rule-notify-weaning",
    key: "notify_in_app_weaning_due",
    label: "In-app weaning notifications",
    category: "compliance",
    valueType: "boolean",
    value: true,
  },
  {
    id: "rule-notify-breeders",
    key: "notify_in_app_breeder_age",
    label: "In-app breeder age notifications",
    category: "breeding",
    valueType: "boolean",
    value: true,
  },
  {
    id: "rule-notify-welfare",
    key: "notify_in_app_welfare",
    label: "In-app welfare notifications",
    category: "welfare",
    valueType: "boolean",
    value: true,
  },
  {
    id: "rule-notify-invoices",
    key: "notify_in_app_invoice",
    label: "In-app invoice notifications",
    category: "compliance",
    valueType: "boolean",
    value: true,
  },
  {
    id: "rule-notify-reservations",
    key: "notify_in_app_reservation_drift",
    label: "In-app reservation drift notifications",
    category: "experiment",
    valueType: "boolean",
    value: true,
  },
];

async function seedEmptyDatabase() {
  assertEmptyBootstrapAllowed();

  const bootstrapPassword = process.env.EMPTY_ADMIN_PASSWORD;
  const profileInstanceId = process.env.EMPTY_PROFILE_INSTANCE_ID;

  if (!bootstrapPassword || bootstrapPassword.length < 12) {
    throw new Error("EMPTY_ADMIN_PASSWORD must be explicitly set to at least 12 characters.");
  }

  if (!profileInstanceId || profileInstanceId.length < 24) {
    throw new Error("EMPTY_PROFILE_INSTANCE_ID must be explicitly set to at least 24 characters.");
  }

  const bootstrapPasswordHash = hashPassword(bootstrapPassword);
  await prisma.$transaction(async (tx) => {
    const operationalCounts = {
      users: await tx.user.count(),
      labs: await tx.lab.count(),
      labMemberships: await tx.labMembership.count(),
      invitations: await tx.userInvitation.count(),
      privilegedRoleChanges: await tx.privilegedRoleChangeRequest.count(),
      dutyRequests: await tx.facilityDutyRequest.count(),
      dutyAssignments: await tx.facilityDutyAssignment.count(),
      dutyLifecycleEvents: await tx.facilityDutyLifecycleEvent.count(),
      externalIdentityLinks: await tx.externalIdentityLink.count(),
      externalIdentityLifecycleEvents: await tx.externalIdentityLifecycleEvent.count(),
      facilities: await tx.facility.count(),
      rooms: await tx.room.count(),
      racks: await tx.rack.count(),
      strains: await tx.strain.count(),
      alleles: await tx.allele.count(),
      chargeCategories: await tx.cageChargeCategory.count(),
      rules: await tx.ruleConfig.count(),
      cages: await tx.cage.count(),
      animals: await tx.animal.count(),
      intakeBatches: await tx.animalIntakeBatch.count(),
      quarantineCases: await tx.quarantineCase.count(),
      quarantineObservations: await tx.quarantineObservation.count(),
      welfareCases: await tx.welfareCase.count(),
      welfareObservations: await tx.welfareObservation.count(),
      welfareTreatmentOrders: await tx.welfareTreatmentOrder.count(),
      welfareAdministrations: await tx.welfareAdministrationAttempt.count(),
      welfareEscalations: await tx.welfareEscalation.count(),
      welfareCaseEvents: await tx.welfareCaseLifecycleEvent.count(),
      animalAlleles: await tx.animalAllele.count(),
      genotypingRecords: await tx.genotypingRecord.count(),
      litters: await tx.litter.count(),
      litterAnimals: await tx.litterAnimal.count(),
      breedingSetups: await tx.breedingSetup.count(),
      breedingAdults: await tx.breedingAdult.count(),
      projects: await tx.project.count(),
      projectAllocations: await tx.animalProjectAllocation.count(),
      experiments: await tx.experiment.count(),
      experimentAssignments: await tx.experimentAssignment.count(),
      samples: await tx.sampleRecord.count(),
      cryostorage: await tx.cryostorageRecord.count(),
      attachments: await tx.attachment.count(),
      statusEvents: await tx.animalStatusEvent.count(),
      animalMovements: await tx.animalMovement.count(),
      cageMovements: await tx.cageMovement.count(),
      cageChargePeriods: await tx.cageChargePeriod.count(),
      cageClosures: await tx.cageClosure.count(),
      cageLabTransfers: await tx.cageLabTransfer.count(),
      animalLabTransfers: await tx.animalLabTransfer.count(),
      invoices: await tx.invoice.count(),
      invoiceLineItems: await tx.invoiceLineItem.count(),
      alerts: await tx.alert.count(),
      notificationEvents: await tx.notificationEvent.count(),
      notificationAudiences: await tx.notificationAudience.count(),
      notificationRecipients: await tx.notificationRecipient.count(),
      notificationPreferences: await tx.notificationPreference.count(),
      notificationDeliveries: await tx.notificationDelivery.count(),
      healthNotes: await tx.healthNote.count(),
      securityEvents: await tx.securityEvent.count(),
      auditLogs: await tx.auditLog.count(),
      workflowDrafts: await tx.workflowDraft.count(),
      workflowReviewSnapshots: await tx.workflowReviewSnapshot.count(),
      commandReceipts: await tx.commandReceipt.count(),
      outboxMessages: await tx.outboxMessage.count(),
      outboxDeliveryAttempts: await tx.outboxDeliveryAttempt.count(),
      sopAcknowledgements: await tx.sopAcknowledgement.count(),
      sopAssignments: await tx.sopAssignment.count(),
      sopVersionApprovals: await tx.sopVersionApproval.count(),
      sopVersions: await tx.sopVersion.count(),
      sopDocuments: await tx.sopDocument.count(),
      identifierAssignments: await tx.facilityIdentifierAssignment.count(),
      legacyIdentifierAliases: await tx.legacyIdentifierAlias.count(),
      migrationRuns: await tx.migrationRun.count(),
      ownershipExceptions: await tx.ownershipException.count(),
    };
    const populatedTables = Object.entries(operationalCounts).filter(([, count]) => count > 0);

    if (populatedTables.length > 0) {
      throw new Error(
        `Refusing empty bootstrap because operational data exists: ${populatedTables
          .map(([table, count]) => `${table}=${count}`)
          .join(", ")}.`,
      );
    }

    for (const profile of EMPTY_PROFILES) {
      await tx.user.upsert({
        where: { id: profile.id },
        update: { name: profile.name, email: profile.email, role: profile.role, active: true },
        create: {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          passwordHash: bootstrapPasswordHash,
          role: profile.role,
          active: true,
        },
      });
    }

    await seedDutyQaFixture(tx, {
      fixturePrefix: "empty",
      requesterId: "user-admin",
      approverId: "user-admin-2",
      grants: [
        { targetUserId: "user-veterinarian", duties: ["designated_veterinarian"] },
        { targetUserId: "user-cmu-staff", duties: ["welfare_officer"] },
        { targetUserId: "user-admin", duties: ["protocol_reviewer", "billing_administrator"] },
        { targetUserId: "user-admin-2", duties: ["training_administrator", "data_steward"] },
      ],
      syntheticIdentities: [
        { userId: "user-admin", subject: "admin@colony.local" },
        { userId: "user-admin-2", subject: "admin.approver@colony.local" },
        { userId: "user-veterinarian", subject: "veterinarian@colony.local" },
        { userId: "user-cmu-staff", subject: "cmu@colony.local" },
      ],
    });

    for (const lab of EMPTY_LABS) {
      await tx.lab.upsert({
        where: { id: lab.id },
        update: { name: lab.name, code: lab.code, active: true },
        create: { ...lab, active: true },
      });
    }

    await tx.facilityIdentitySequence.upsert({
      where: { entityType: "animal" },
      update: { minimumValue: 1, maximumValue: 9999, width: 4 },
      create: { entityType: "animal", nextValue: 1, minimumValue: 1, maximumValue: 9999, width: 4 },
    });
    await tx.facilityIdentitySequence.upsert({
      where: { entityType: "cage" },
      update: { minimumValue: 1000, maximumValue: 9999, width: 4 },
      create: { entityType: "cage", nextValue: 1000, minimumValue: 1000, maximumValue: 9999, width: 4 },
    });

    await tx.labMembership.deleteMany({
      where: { userId: { in: ["user-it-head", "user-admin", "user-admin-2", "user-cmu-staff", "user-veterinarian"] } },
    });

    const memberships = [
      { id: "membership-user1-lab1", labId: "lab-default", userId: "user-lab-1", role: "manager" as const },
      { id: "membership-user2-lab2", labId: "lab-2", userId: "user-lab-2", role: "manager" as const },
    ];

    for (const membership of memberships) {
      await tx.labMembership.upsert({
        where: { labId_userId: { labId: membership.labId, userId: membership.userId } },
        update: { role: membership.role, active: true },
        create: { ...membership, active: true },
      });
    }

    await tx.facility.upsert({
      where: { cageBarcodePrefix: "MC" },
      update: { name: "My Facility", maxCageOccupancy: 6 },
      create: {
        id: "facility-default",
        name: "My Facility",
        cageBarcodePrefix: "MC",
        maxCageOccupancy: 6,
      },
    });

    await tx.room.upsert({
      where: { facilityId_roomNumber: { facilityId: "facility-default", roomNumber: "ROOM-1" } },
      update: {},
      create: { id: "room-default", facilityId: "facility-default", roomNumber: "ROOM-1" },
    });

    await tx.rack.upsert({
      where: { roomId_rackNumber: { roomId: "room-default", rackNumber: "R1" } },
      update: {},
      create: { id: "rack-default", roomId: "room-default", rackNumber: "R1" },
    });

    await tx.strain.upsert({
      where: { name: "C57BL/6J" },
      update: {},
      create: {
        id: "strain-c57bl6j",
        name: "C57BL/6J",
        background: "C57BL/6J",
        notes: "Reference strain available for the first intake record.",
      },
    });

    await tx.cageChargeCategory.upsert({
      where: { code: "STANDARD" },
      update: { name: "Standard cage", active: true },
      create: {
        id: "charge-standard",
        name: "Standard cage",
        code: "STANDARD",
        dailyRateCents: 0,
        currencyCode: "USD",
        active: true,
        notes: "Set the facility rate before generating invoices.",
      },
    });

    for (const rule of rules) {
      await tx.ruleConfig.upsert({
        where: { key: rule.key },
        update: {
          label: rule.label,
          category: rule.category,
          valueType: rule.valueType,
          value: rule.value,
          description: rule.description,
          criticalBlock: rule.criticalBlock,
        },
        create: rule,
      });
    }

    await tx.ruleConfig.upsert({
      where: { key: "empty_profile_switcher_instance" },
      update: { value: profileInstanceId },
      create: {
        id: "rule-empty-profile-instance",
        key: "empty_profile_switcher_instance",
        label: "Empty profile switcher instance",
        category: "compliance",
        valueType: "text",
        value: profileInstanceId,
        description: "Private marker for the isolated local profile switcher.",
        criticalBlock: true,
      },
    });
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 30_000,
  });

  console.log("Empty colony ready: configuration and guarded duty-QA identities created; colony tables left empty.");
}

seedEmptyDatabase()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
