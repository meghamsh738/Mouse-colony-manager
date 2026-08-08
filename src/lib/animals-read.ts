import { compareDesc, differenceInDays } from "date-fns";

import { normalizeUserRole, type Capability } from "@/lib/capabilities";
import { canViewLab, getActorReadLabAccess, type LabActor } from "@/lib/lab-access";
import { parseExternalTransferProvenance } from "@/lib/lifecycle-provenance";
import { prisma } from "@/lib/prisma";
import type { Alert, AnimalListItem, AnimalStatus, AlertSeverity } from "@/lib/types";
import { formatAgeLabel, titleCase } from "@/lib/utils";

type AnimalReadActor = LabActor & {
  canonicalRole?: ReturnType<typeof normalizeUserRole>;
  capabilities?: readonly Capability[];
};

function canReadExperiments(actor: AnimalReadActor) {
  if (actor.capabilities) return actor.capabilities.includes("experiments:full");
  return (actor.canonicalRole ?? normalizeUserRole(actor.role)) !== "cmu_staff";
}

type AnimalRuleContext = {
  breederMaxAgeDays: number;
  breederMinAgeDays: number;
  genotypePendingDays: number;
  projectAssignmentRequiredDays: number;
  today: string;
};

function getReferenceDate() {
  return process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString();
}

function getAgeDays(dob: Date, referenceDate: string) {
  return differenceInDays(new Date(referenceDate), dob);
}

function buildCageLabel(
  cage?:
    | {
        cageNumber: string;
        room: { roomNumber: string };
        rack: { rackNumber: string };
      }
    | null
    | undefined,
  status?: AnimalStatus,
) {
  if (!cage) {
    return status === "archived" ? "Archived" : "Not in cage";
  }

  return `${cage.room.roomNumber} / ${cage.rack.rackNumber} / ${cage.cageNumber}`;
}

function buildGenotypeSummary(
  alleles: Array<{
    zygosity: string;
    allele: { name: string };
  }>,
) {
  if (!alleles.length) {
    return "Genotype not recorded";
  }

  return alleles
    .map(({ allele, zygosity }) => `${allele.name}${zygosity === "WT/WT" ? " WT/WT" : ` ${zygosity}`}`)
    .join(" ; ");
}

function isGenotypeConfirmed(
  alleles: Array<{
    callStatus: string;
  }>,
) {
  return alleles.length > 0 && alleles.every((allele) => allele.callStatus === "confirmed");
}

function getPendingGenotypeRecord(
  alleles: Array<{
    callStatus: string;
  }>,
  genotypingRecords: Array<{
    sampleDate: Date;
    status: string;
  }>,
) {
  const pendingRecord = genotypingRecords.find((record) => record.status === "pending");

  if (!pendingRecord) {
    return null;
  }

  const hasPendingAllele = alleles.some((allele) => allele.callStatus === "pending");

  if (hasPendingAllele || alleles.length === 0) {
    return pendingRecord;
  }

  return null;
}

function buildRuleAlerts(
  animal: {
    id: string;
    animalId: string;
    dob: Date;
    status: AnimalStatus;
    healthNotes: Array<{
      id: string;
      note: string;
      severity: AlertSeverity;
      resolved: boolean;
      followupRequired: boolean;
      createdAt: Date;
    }>;
    alleles: Array<{
      callStatus: string;
    }>;
    genotypingRecords: Array<{
      sampleDate: Date;
      status: string;
    }>;
    projectAllocations: Array<{ id: string; endedAt: Date | null }>;
  },
  rules: AnimalRuleContext,
) {
  const alerts: Alert[] = [];
  const ageDays = getAgeDays(animal.dob, rules.today);
  const unresolvedHealthNote = animal.healthNotes.find((note) => !note.resolved && note.followupRequired);
  const pendingRecord = getPendingGenotypeRecord(animal.alleles, animal.genotypingRecords);

  if (animal.status === "breeding" && ageDays > rules.breederMaxAgeDays) {
    alerts.push({
      id: `rule-breeder-old-${animal.id}`,
      entityType: "animal",
      entityId: animal.id,
      alertType: "breeder_too_old",
      severity: "warning",
      message: `${animal.animalId} is ${ageDays} days old and above the breeder age preference.`,
      status: "open",
      generatedAt: rules.today,
      source: "rule",
    });
  }

  if (animal.status === "breeding" && ageDays < rules.breederMinAgeDays) {
    alerts.push({
      id: `rule-breeder-young-${animal.id}`,
      entityType: "animal",
      entityId: animal.id,
      alertType: "breeder_too_young",
      severity: "critical",
      message: `${animal.animalId} is not yet old enough for breeding under the configured threshold.`,
      status: "open",
      generatedAt: rules.today,
      source: "rule",
    });
  }

  if (pendingRecord && differenceInDays(new Date(rules.today), pendingRecord.sampleDate) > rules.genotypePendingDays) {
    alerts.push({
      id: `rule-genotype-pending-${animal.id}`,
      entityType: "animal",
      entityId: animal.id,
      alertType: "genotype_pending",
      severity: "warning",
      message: `${animal.animalId} still has a pending genotype result beyond the configured threshold.`,
      status: "open",
      generatedAt: rules.today,
      source: "rule",
    });
  }

  if (
    animal.status === "colony_holding" &&
    ageDays > rules.projectAssignmentRequiredDays &&
    animal.projectAllocations.every((allocation) => allocation.endedAt !== null)
  ) {
    alerts.push({
      id: `rule-project-missing-${animal.id}`,
      entityType: "animal",
      entityId: animal.id,
      alertType: "project_missing",
      severity: "info",
      message: `${animal.animalId} is older than the project assignment threshold without an active allocation.`,
      status: "open",
      generatedAt: rules.today,
      source: "rule",
    });
  }

  if (unresolvedHealthNote) {
    alerts.push({
      id: `rule-health-followup-${animal.id}`,
      entityType: "animal",
      entityId: animal.id,
      alertType: "health_followup",
      severity: unresolvedHealthNote.severity,
      message: `${animal.animalId} has an unresolved follow-up note: ${unresolvedHealthNote.note}`,
      status: "open",
      generatedAt: unresolvedHealthNote.createdAt.toISOString(),
      source: "rule",
    });
  }

  return alerts;
}

async function getAnimalRuleContext(): Promise<AnimalRuleContext> {
  const keys = [
    "breeder_max_age_days",
    "breeder_min_age_days",
    "genotype_pending_days",
    "project_assignment_required_days",
  ];
  const rules = await prisma.ruleConfig.findMany({
    where: {
      key: { in: keys },
    },
    select: {
      key: true,
      value: true,
    },
  });

  const values = new Map(rules.map((rule) => [rule.key, Number(rule.value)]));

  return {
    breederMaxAgeDays: values.get("breeder_max_age_days") ?? 0,
    breederMinAgeDays: values.get("breeder_min_age_days") ?? 0,
    genotypePendingDays: values.get("genotype_pending_days") ?? 0,
    projectAssignmentRequiredDays: values.get("project_assignment_required_days") ?? 0,
    today: getReferenceDate(),
  };
}

export async function getAnimalPageOptions(actor: AnimalReadActor) {
  const access = await getActorReadLabAccess(actor);
  const [cages, strains, projects] = await prisma.$transaction([
    prisma.cage.findMany({
      where: {
        status: { notIn: ["closed", "retired"] },
        ...(access && !access.canViewAll ? { labId: { in: access.memberLabIds } } : {}),
      },
      orderBy: [{ room: { roomNumber: "asc" } }, { rack: { rackNumber: "asc" } }, { cageNumber: "asc" }],
      include: {
        room: { select: { roomNumber: true } },
        rack: { select: { rackNumber: true } },
      },
    }),
    prisma.strain.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.project.findMany({
      where: access && !access.canViewAll ? { labId: { in: access.memberLabIds } } : undefined,
      orderBy: { projectCode: "asc" },
      select: { id: true, projectCode: true, title: true },
    }),
  ]);

  return {
    cageOptions: cages.map((cage) => ({
      id: cage.id,
      label: `${buildCageLabel(cage)} · ${cage.barcode}`,
    })),
    strainOptions: strains.map((strain) => ({
      id: strain.id,
      label: strain.name,
    })),
    projectOptions: projects.map((project) => ({
      id: project.id,
      label: `${project.projectCode} · ${project.title}`,
    })),
  };
}

export async function getAnimalListView(
  actor: AnimalReadActor,
  options: { includeTerminal?: boolean } = {},
): Promise<AnimalListItem[]> {
  const rules = await getAnimalRuleContext();
  const access = await getActorReadLabAccess(actor);
  const includeExperiments = canReadExperiments(actor);
  const animals = await prisma.animal.findMany({
    where: {
      ...(options.includeTerminal ? {} : { outcomeStatus: "alive" }),
      ...(access && !access.canViewAll ? { owningLabId: { in: access.memberLabIds } } : {}),
    },
    orderBy: { animalId: "asc" },
    include: {
      strain: { select: { name: true } },
      owningLab: { select: { id: true, name: true, code: true } },
      currentCage: {
        include: {
          lab: { select: { id: true, name: true, code: true } },
          room: { select: { roomNumber: true } },
          rack: { select: { rackNumber: true } },
        },
      },
      alleles: {
        include: {
          allele: { select: { name: true } },
        },
      },
      projectAllocations: {
        where: { endedAt: null },
        include: {
          project: { select: { projectCode: true } },
        },
      },
      experimentAssignments: {
        where: !includeExperiments
          ? { id: "__experiments_denied__" }
          : access && !access.canViewAll
            ? { experiment: { labId: { in: access.memberLabIds } } }
            : undefined,
        include: {
          experiment: { select: { experimentCode: true } },
        },
      },
      healthNotes: {
        where: access && !access.canViewAll ? { labId: { in: access.memberLabIds } } : undefined,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          labId: true,
          note: true,
          severity: true,
          resolved: true,
          followupRequired: true,
          createdAt: true,
        },
      },
      genotypingRecords: {
        where: access && !access.canViewAll ? { labId: { in: access.memberLabIds } } : undefined,
        orderBy: { sampleDate: "desc" },
        select: {
          labId: true,
          sampleDate: true,
          status: true,
        },
      },
    },
  });

  const manualAlerts = animals.length
    ? await prisma.alert.findMany({
        where: {
          entityType: "animal",
          entityId: { in: animals.map((animal) => animal.id) },
          status: "open",
          ...(access && !access.canViewAll ? { labId: { in: access.memberLabIds } } : {}),
        },
        orderBy: { generatedAt: "desc" },
      })
    : [];

  const manualAlertsByAnimalId = new Map<string, Alert[]>();

  for (const alert of manualAlerts) {
    if (access && !access.canViewAll && (!alert.labId || !access.memberLabIds.includes(alert.labId))) continue;
    const current = manualAlertsByAnimalId.get(alert.entityId) ?? [];
    current.push({
      id: alert.id,
      entityType: "animal",
      entityId: alert.entityId,
      alertType: alert.alertType,
      severity: alert.severity,
      message: alert.message,
      status: alert.status,
      generatedAt: alert.generatedAt.toISOString(),
      resolvedAt: alert.resolvedAt?.toISOString(),
      source: (alert.source as "rule" | "manual") ?? "manual",
    });
    manualAlertsByAnimalId.set(alert.entityId, current);
  }

  return animals.map((animal) => {
    const scopedHealthNotes = access && !access.canViewAll
      ? animal.healthNotes.filter((note) => access.memberLabIds.includes(note.labId))
      : animal.healthNotes;
    const scopedGenotypingRecords = access && !access.canViewAll
      ? animal.genotypingRecords.filter((record) => access.memberLabIds.includes(record.labId))
      : animal.genotypingRecords;
    const ruleAlerts = buildRuleAlerts(
      { ...animal, healthNotes: scopedHealthNotes, genotypingRecords: scopedGenotypingRecords },
      rules,
    );
    const warnings = [...(manualAlertsByAnimalId.get(animal.id) ?? []), ...ruleAlerts].sort((left, right) =>
      compareDesc(new Date(left.generatedAt), new Date(right.generatedAt)),
    );
    const genotypeConfirmed = isGenotypeConfirmed(animal.alleles);
    const activeExperiment = animal.experimentAssignments.some((assignment) => assignment.status === "active");
    const hasCriticalWarning = warnings.some((alert) => alert.severity === "critical");

    return {
      id: animal.id,
      animalId: animal.animalId,
      labId: animal.labId,
      owningLabId: animal.owningLab?.id ?? animal.currentCage?.lab?.id ?? null,
      owningLabName: animal.owningLab?.name ?? animal.currentCage?.lab?.name ?? null,
      sex: animal.sex,
      ageDays: getAgeDays(animal.dob, rules.today),
      ageLabel: formatAgeLabel(getAgeDays(animal.dob, rules.today)),
      dob: animal.dob.toISOString(),
      healthStatus: animal.healthStatus,
      strain: animal.strain.name,
      genotypeSummary: buildGenotypeSummary(animal.alleles),
      cageLabel: buildCageLabel(animal.currentCage, animal.status),
      status: animal.status,
      projectCodes: animal.projectAllocations.map((allocation) => allocation.project.projectCode),
      experimentSummary:
        animal.experimentAssignments.map((assignment) => assignment.experiment.experimentCode).join(", ") || "None",
      warnings: warnings.map((alert) => alert.message),
      genotypeConfirmed,
      availableForExperiment: animal.status === "colony_holding" && genotypeConfirmed && !activeExperiment && !hasCriticalWarning,
    };
  });
}

export async function getAnimalDetailView(animalId: string, actor: AnimalReadActor) {
  const rules = await getAnimalRuleContext();
  const access = await getActorReadLabAccess(actor);
  const includeExperiments = canReadExperiments(actor);
  const animal = await prisma.animal.findUnique({
    where: { id: animalId },
    include: {
      strain: { select: { name: true } },
      owningLab: { select: { id: true, name: true, code: true } },
      currentCage: {
        include: {
          lab: { select: { id: true, name: true, code: true } },
          room: { select: { roomNumber: true } },
          rack: { select: { rackNumber: true } },
        },
      },
      sire: { select: { animalId: true } },
      dam: { select: { animalId: true } },
      alleles: {
        include: {
          allele: { select: { name: true } },
        },
      },
      projectAllocations: {
        where: { endedAt: null },
        include: {
          project: { select: { id: true, labId: true, projectCode: true, title: true } },
        },
      },
      breedingAdults: {
        where: { breedingSetup: { status: { in: ["planned", "active", "paused"] } } },
        select: { breedingSetupId: true },
      },
      experimentAssignments: {
        where: !includeExperiments
          ? { id: "__experiments_denied__" }
          : access && !access.canViewAll
            ? { experiment: { labId: { in: access.memberLabIds } } }
            : undefined,
        orderBy: { startDate: "desc" },
        include: {
          experiment: { select: { id: true, experimentCode: true, title: true, status: true } },
        },
      },
      healthNotes: {
        where: {
          animalId,
          ...(access && !access.canViewAll ? { labId: { in: access.memberLabIds } } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          labId: true,
          note: true,
          noteType: true,
          severity: true,
          resolved: true,
          followupRequired: true,
          createdAt: true,
          attachments: {
            select: {
              id: true,
              labId: true,
              label: true,
              fileName: true,
              fileType: true,
              storageUrl: true,
            },
          },
        },
      },
      genotypingRecords: {
        where: access && !access.canViewAll ? { labId: { in: access.memberLabIds } } : undefined,
        orderBy: { resultDate: "desc" },
        select: {
          id: true,
          labId: true,
          markerTested: true,
          sourceType: true,
          assayType: true,
          sampleId: true,
          status: true,
          resultDate: true,
          resultText: true,
          provider: true,
          confidence: true,
          finalCall: true,
          sampleDate: true,
          attachments: {
            select: {
              id: true,
              labId: true,
              label: true,
              fileName: true,
              fileType: true,
              storageUrl: true,
            },
          },
        },
      },
      sampleRecords: {
        orderBy: [{ collectedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          labId: true,
          sampleLabel: true,
          sampleType: true,
          status: true,
          collectedAt: true,
          storageLocation: true,
          quantityLabel: true,
          notes: true,
          project: {
            select: {
              id: true,
              labId: true,
              projectCode: true,
            },
          },
        },
      },
      statusEvents: {
        orderBy: { happenedAt: "desc" },
        select: {
          id: true,
          toStatus: true,
          happenedAt: true,
          reason: true,
          sopVersionNumber: true,
          sopContentHash: true,
          sop: { select: { code: true, title: true } },
        },
      },
    },
  });

  if (!animal) {
    return null;
  }

  if (access && !canViewLab(access, animal.owningLabId ?? animal.currentCage?.labId)) {
    return null;
  }

  if (access && !access.canViewAll && animal.currentCage && animal.currentCage.labId !== animal.owningLabId) {
    return null;
  }

  const visibleProjectAllocations = animal.projectAllocations.filter(
    (allocation) => access?.canViewAll || allocation.project.labId === animal.owningLabId,
  );
  const visibleGenotypingRecords = animal.genotypingRecords.filter(
    (record) => access?.canViewAll || Boolean(access?.memberLabIds.includes(record.labId)),
  );
  const visibleSampleRecords = animal.sampleRecords.filter(
    (record) =>
      access?.canViewAll ||
      (record.labId === animal.owningLabId && (!record.project || record.project.labId === record.labId)),
  );
  const visibleHealthNotes = animal.healthNotes.filter(
    (note) => access?.canViewAll || Boolean(access?.memberLabIds.includes(note.labId)),
  );
  const [externalTransferAudit, openExperimentCount] = await Promise.all([
    animal.outcomeStatus === "transferred" ? prisma.auditLog.findFirst({
        where: {
          entityType: "animal",
          entityId: animal.id,
          action: "lifecycle_update",
          newValue: { path: ["status"], equals: "transferred_out" },
        },
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
        select: { newValue: true },
      }) : null,
    prisma.experimentAssignment.count({
      where: { animalId: animal.id, status: { in: ["planned", "reserved", "active"] } },
    }),
  ]);
  const externalTransfer = parseExternalTransferProvenance(externalTransferAudit?.newValue);

  const experiments = includeExperiments ? await prisma.experiment.findMany({
    where: {
      status: { in: ["planned", "active"] },
      labId: animal.owningLabId,
      ...(access && !access.canViewAll ? { labId: { in: access.memberLabIds } } : {}),
    },
    orderBy: { experimentCode: "asc" },
    select: { id: true, experimentCode: true, title: true, version: true },
  }) : [];
  const alleleOptions = await prisma.allele.findMany({
    orderBy: [{ gene: "asc" }, { name: "asc" }],
    select: {
      id: true,
      gene: true,
      name: true,
      type: true,
    },
  });
  const projectOptions = await prisma.project.findMany({
    where: access && !access.canViewAll ? { labId: { in: access.memberLabIds } } : undefined,
    orderBy: { projectCode: "asc" },
    select: {
      id: true,
      projectCode: true,
      title: true,
    },
  });
  const manualAlerts = await prisma.alert.findMany({
    where: {
      entityType: "animal",
      entityId: animalId,
      status: "open",
      ...(access && !access.canViewAll ? { labId: { in: access.memberLabIds } } : {}),
    },
    orderBy: { generatedAt: "desc" },
  });
  const visibleManualAlerts = manualAlerts.filter(
    (alert) => access?.canViewAll || Boolean(alert.labId && access?.memberLabIds.includes(alert.labId)),
  );

  const alerts = [
    ...visibleManualAlerts.map<Alert>((alert) => ({
      id: alert.id,
      entityType: "animal",
      entityId: alert.entityId,
      alertType: alert.alertType,
      severity: alert.severity,
      message: alert.message,
      status: alert.status,
      generatedAt: alert.generatedAt.toISOString(),
      resolvedAt: alert.resolvedAt?.toISOString(),
      source: (alert.source as "rule" | "manual") ?? "manual",
    })),
    ...buildRuleAlerts(
      {
        ...animal,
        healthNotes: visibleHealthNotes,
        genotypingRecords: visibleGenotypingRecords,
        projectAllocations: visibleProjectAllocations,
      },
      rules,
    ),
  ].sort((left, right) => compareDesc(new Date(left.generatedAt), new Date(right.generatedAt)));

  const timeline = [
    ...visibleGenotypingRecords.map((record) => ({
      id: `geno-${record.id}`,
      date: record.resultDate.toISOString(),
      label: `Genotype ${record.status}`,
      description: record.finalCall,
    })),
    ...visibleSampleRecords.map((record) => ({
      id: `sample-${record.id}`,
      date: record.collectedAt.toISOString(),
      label: `Sample ${titleCase(record.status)}`,
      description: `${record.sampleLabel} · ${record.sampleType}${record.project?.projectCode ? ` · ${record.project.projectCode}` : ""}`,
    })),
    ...animal.statusEvents.map((event) => ({
      id: event.id,
      date: event.happenedAt.toISOString(),
      label: titleCase(event.toStatus),
      description: `${event.reason ?? "Status updated"}${event.sop ? ` · ${event.sop.code} v${event.sopVersionNumber} · ${event.sopContentHash?.slice(0, 12)}` : ""}`,
    })),
    ...animal.experimentAssignments.map((assignment) => ({
      id: assignment.id,
      date: assignment.startDate.toISOString(),
      label: `Experiment ${assignment.status}`,
      description: `${assignment.experiment.experimentCode}${assignment.treatmentGroup ? ` · ${assignment.treatmentGroup}` : ""}`,
    })),
  ].sort((left, right) => compareDesc(new Date(left.date), new Date(right.date)));

  return {
    animal: {
      id: animal.id,
      version: animal.version,
      animalId: animal.animalId,
      labId: animal.labId,
      owningLabId: animal.owningLabId,
      status: animal.status,
      dob: animal.dob.toISOString(),
      outcomeStatus: animal.outcomeStatus,
      experimentalStatus: animal.experimentalStatus,
      deathDate: animal.deathDate?.toISOString() ?? null,
      deathReason: animal.deathReason ?? null,
    },
    cageLabel: buildCageLabel(animal.currentCage, animal.status),
    strainName: animal.strain.name,
    genotypeSummary: buildGenotypeSummary(animal.alleles),
    effectiveAlleles: animal.alleles.map((entry) => ({
      id: entry.id,
      alleleId: entry.alleleId,
      alleleName: entry.allele.name,
      zygosity: entry.zygosity,
      callStatus: entry.callStatus,
    })),
    genotypingRecords: visibleGenotypingRecords.map((record) => ({
      id: record.id,
      markerTested: record.markerTested,
      sourceType: record.sourceType,
      assayType: record.assayType,
      sampleId: record.sampleId ?? null,
      status: record.status,
      sampleDate: record.sampleDate.toISOString(),
      resultDate: record.resultDate.toISOString(),
      resultText: record.resultText,
      provider: record.provider ?? null,
      confidence: record.confidence ?? null,
      finalCall: record.finalCall,
      attachments: record.attachments.filter((attachment) => attachment.labId === record.labId).map((attachment) => ({
        id: attachment.id,
        label: attachment.label,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        storageUrl: attachment.storageUrl,
      })),
    })),
    sampleRecords: visibleSampleRecords.map((record) => ({
      id: record.id,
      sampleLabel: record.sampleLabel,
      sampleType: record.sampleType,
      status: record.status,
      collectedAt: record.collectedAt.toISOString(),
      storageLocation: record.storageLocation ?? null,
      quantityLabel: record.quantityLabel ?? null,
      notes: record.notes ?? null,
      projectCode: record.project?.projectCode ?? null,
    })),
    sireAnimalId: animal.sire?.animalId ?? null,
    damAnimalId: animal.dam?.animalId ?? null,
    alerts,
    assignments: animal.experimentAssignments.map((assignment) => ({
      id: assignment.id,
      status: assignment.status,
      treatmentGroup: assignment.treatmentGroup ?? null,
      experimentCode: assignment.experiment.experimentCode,
    })),
    openBreedingCount: animal.breedingAdults.length,
    openExperimentCount,
    externalTransfer,
    timeline,
    notes: visibleHealthNotes.map((note) => ({
      id: note.id,
      note: note.note,
      noteType: note.noteType,
      createdAt: note.createdAt.toISOString(),
      attachments: note.attachments.filter((attachment) => attachment.labId === note.labId).map((attachment) => ({
        id: attachment.id,
        label: attachment.label,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        storageUrl: attachment.storageUrl,
      })),
    })),
    canReserve: animal.status === "colony_holding",
    canRecordGenotype: animal.outcomeStatus === "alive",
    canRecordSample: animal.status !== "archived",
    defaultLifecycleDate: rules.today.slice(0, 10),
    alleleOptions: alleleOptions.map((allele) => ({
      id: allele.id,
      label: `${allele.name} · ${allele.gene} · ${allele.type}`,
    })),
    defaultGenotypeDate: rules.today.slice(0, 10),
    experimentOptions: experiments.map((experiment) => ({
      id: experiment.id,
      label: `${experiment.experimentCode} · ${experiment.title}`,
      version: experiment.version,
    })),
    projectOptions: projectOptions.map((project) => ({
      id: project.id,
      label: `${project.projectCode} · ${project.title}`,
    })),
    defaultSampleDate: rules.today.slice(0, 10),
    defaultSampleProjectId: visibleProjectAllocations[0]?.project.id ?? null,
    projectCodes: visibleProjectAllocations.map((allocation) => allocation.project.projectCode),
  };
}
