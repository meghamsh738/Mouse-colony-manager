import { compareDesc, differenceInDays, parseISO } from "date-fns";

import { getColonyDataSnapshot } from "@/lib/colony-data";
import { formatAgeLabel, formatDate, formatPercent, getAgeInDays, titleCase } from "@/lib/utils";
import type {
  Alert,
  Animal,
  AnimalListItem,
  BreedingSuggestion,
  Cage,
  CageListItem,
  DemoColonyData,
  ExperimentCandidate,
  RuleConfig,
} from "@/lib/types";

export const runtimeMode = "postgresql";
export let colonyData = {} as DemoColonyData;

export async function getColonyData() {
  colonyData = await getColonyDataSnapshot();

  return colonyData;
}

function getRuleConfig(key: string) {
  return colonyData.ruleConfigs.find((rule) => rule.key === key);
}

function getRuleNumber(key: string) {
  const rule = getRuleConfig(key);

  return typeof rule?.value === "number" ? rule.value : 0;
}

function getRuleBoolean(key: string) {
  const rule = getRuleConfig(key);

  return typeof rule?.value === "boolean" ? rule.value : false;
}

function getActiveAnimals() {
  return colonyData.animals.filter((animal) => animal.outcomeStatus === "alive");
}

export function getUser(userId?: string | null) {
  return colonyData.users.find((user) => user.id === userId) ?? null;
}

export function getAnimal(animalId: string) {
  return colonyData.animals.find((animal) => animal.id === animalId) ?? null;
}

export function getCage(cageId: string) {
  return colonyData.cages.find((cage) => cage.id === cageId) ?? null;
}

export function getCageByBarcode(barcode: string) {
  return colonyData.cages.find((cage) => cage.barcode === barcode) ?? null;
}

export function getExperiment(experimentId: string) {
  return colonyData.experiments.find((experiment) => experiment.id === experimentId) ?? null;
}

export function getProject(projectId: string) {
  return colonyData.projects.find((project) => project.id === projectId) ?? null;
}

export function getStrain(strainId: string) {
  return colonyData.strains.find((strain) => strain.id === strainId) ?? null;
}

export function getRoom(roomId: string) {
  return colonyData.rooms.find((room) => room.id === roomId) ?? null;
}

export function getRack(rackId: string) {
  return colonyData.racks.find((rack) => rack.id === rackId) ?? null;
}

export function getCageLabel(cageId?: string | null) {
  if (!cageId) {
    return "Archived";
  }

  const cage = getCage(cageId);

  if (!cage) {
    return "Unknown cage";
  }

  const room = getRoom(cage.roomId);
  const rack = getRack(cage.rackId);

  return `${room?.roomNumber ?? "?"} / ${rack?.rackNumber ?? "?"} / ${cage.cageNumber}`;
}

export function getAnimalsForCage(cageId: string) {
  return getActiveAnimals().filter((animal) => animal.currentCageId === cageId);
}

export function getAnimalAgeDays(animal: Animal) {
  return getAgeInDays(animal.dob, colonyData.today);
}

export function getAnimalAgeLabel(animal: Animal) {
  return formatAgeLabel(getAnimalAgeDays(animal));
}

export function getAnimalAlleles(animalId: string) {
  return colonyData.animalAlleles.filter((allele) => allele.animalId === animalId);
}

export function getAnimalGenotypingRecords(animalId: string) {
  return colonyData.genotypingRecords.filter((record) => record.animalId === animalId);
}

export function getAnimalGenotypeSummary(animalId: string) {
  const alleles = getAnimalAlleles(animalId);

  if (!alleles.length) {
    return "Genotype not recorded";
  }

  return alleles
    .map((animalAllele) => {
      const allele = colonyData.alleles.find((candidate) => candidate.id === animalAllele.alleleId);

      if (!allele) {
        return animalAllele.zygosity;
      }

      return `${allele.name}${animalAllele.zygosity === "WT/WT" ? " WT/WT" : ` ${animalAllele.zygosity}`}`;
    })
    .join(" ; ");
}

export function isGenotypeConfirmed(animalId: string) {
  const alleles = getAnimalAlleles(animalId);

  return alleles.length > 0 && alleles.every((allele) => allele.callStatus === "confirmed");
}

export function getAnimalProjects(animalId: string) {
  return colonyData.projectAllocations
    .filter((allocation) => allocation.animalId === animalId && !allocation.endedAt)
    .map((allocation) => getProject(allocation.projectId))
    .filter((project): project is NonNullable<typeof project> => Boolean(project));
}

export function getAnimalAssignments(animalId: string) {
  return colonyData.experimentAssignments.filter((assignment) => assignment.animalId === animalId);
}

export function getAnimalHealthNotes(animalId: string) {
  return colonyData.healthNotes.filter((note) => note.animalId === animalId);
}

export function getCageHealthNotes(cageId: string) {
  return colonyData.healthNotes.filter((note) => note.cageId === cageId);
}

export function getBreedingForAnimal(animalId: string) {
  const breedingLink = colonyData.breedingAdults.find((adult) => adult.animalId === animalId);

  return breedingLink
    ? colonyData.breedingSetups.find((setup) => setup.id === breedingLink.breedingSetupId) ?? null
    : null;
}

function getBreedingAdults(setupId: string) {
  return colonyData.breedingAdults
    .filter((adult) => adult.breedingSetupId === setupId)
    .map((adult) => ({
      ...adult,
      animal: getAnimal(adult.animalId),
    }));
}

export function getLitterForAnimal(animalId: string) {
  const link = colonyData.litterAnimals.find((item) => item.animalId === animalId);

  return link ? colonyData.litters.find((litter) => litter.id === link.litterId) ?? null : null;
}

function getBaseRuleAlerts(data: DemoColonyData) {
  const alerts: Alert[] = [];
  const breederMaxAge = getRuleNumber("breeder_max_age_days");
  const breederMinAge = getRuleNumber("breeder_min_age_days");
  const breedingDurationMax = getRuleNumber("breeding_duration_max_days");
  const weaningDueDays = getRuleNumber("weaning_due_days");
  const genotypePendingDays = getRuleNumber("genotype_pending_days");
  const cageMaxOccupancy = getRuleNumber("cage_max_occupancy");
  const allowMixedSexHolding = getRuleBoolean("mixed_sex_holding_allowed");
  const reservationGrace = getRuleNumber("reservation_start_grace_days");
  const projectAssignmentThreshold = getRuleNumber("project_assignment_required_days");

  getActiveAnimals().forEach((animal) => {
    const ageDays = getAnimalAgeDays(animal);
    const unresolvedHealthNote = getAnimalHealthNotes(animal.id).find(
      (note) => !note.resolved && note.followupRequired,
    );

    if (animal.status === "breeding" && ageDays > breederMaxAge) {
      alerts.push({
        id: `rule-breeder-old-${animal.id}`,
        entityType: "animal",
        entityId: animal.id,
        alertType: "breeder_too_old",
        severity: "warning",
        message: `${animal.animalId} is ${ageDays} days old and above the breeder age preference.`,
        status: "open",
        generatedAt: data.today,
        source: "rule",
      });
    }

    if (animal.status === "breeding" && ageDays < breederMinAge) {
      alerts.push({
        id: `rule-breeder-young-${animal.id}`,
        entityType: "animal",
        entityId: animal.id,
        alertType: "breeder_too_young",
        severity: "critical",
        message: `${animal.animalId} is not yet old enough for breeding under the configured threshold.`,
        status: "open",
        generatedAt: data.today,
        source: "rule",
      });
    }

    const pendingRecord = getAnimalGenotypingRecords(animal.id).find((record) => record.status === "pending");

    if (
      pendingRecord &&
      differenceInDays(parseISO(data.today), parseISO(pendingRecord.sampleDate)) > genotypePendingDays
    ) {
      alerts.push({
        id: `rule-genotype-pending-${animal.id}`,
        entityType: "animal",
        entityId: animal.id,
        alertType: "genotype_pending",
        severity: "warning",
        message: `${animal.animalId} still has a pending genotype result beyond the configured threshold.`,
        status: "open",
        generatedAt: data.today,
        source: "rule",
      });
    }

    if (
      animal.status === "colony_holding" &&
      ageDays > projectAssignmentThreshold &&
      getAnimalProjects(animal.id).length === 0
    ) {
      alerts.push({
        id: `rule-project-missing-${animal.id}`,
        entityType: "animal",
        entityId: animal.id,
        alertType: "project_missing",
        severity: "info",
        message: `${animal.animalId} is older than the project assignment threshold without an active allocation.`,
        status: "open",
        generatedAt: data.today,
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
        generatedAt: unresolvedHealthNote.createdAt,
        source: "rule",
      });
    }
  });

  data.breedingSetups.forEach((setup) => {
    if (
      setup.status === "active" &&
      differenceInDays(parseISO(data.today), parseISO(setup.startDate)) > breedingDurationMax
    ) {
      alerts.push({
        id: `rule-breeding-duration-${setup.id}`,
        entityType: "cage",
        entityId: setup.id,
        alertType: "breeding_duration",
        severity: "warning",
        message: `${setup.id} has been active beyond the configured breeding duration window.`,
        status: "open",
        generatedAt: data.today,
        source: "rule",
      });
    }
  });

  data.litters.forEach((litter) => {
    if (!litter.litterSizeWean) {
      const litterAge = differenceInDays(parseISO(data.today), parseISO(litter.birthDate));

      if (litterAge > weaningDueDays) {
        alerts.push({
          id: `rule-weaning-${litter.id}`,
          entityType: "litter",
          entityId: litter.id,
          alertType: "weaning_due",
          severity: "warning",
          message: `${litter.id} is ${litterAge} days old and still has no recorded weaning outcome.`,
          status: "open",
          generatedAt: data.today,
          source: "rule",
        });
      }
    }
  });

  data.cages.forEach((cage) => {
    const occupants = getAnimalsForCage(cage.id);
    const sexes = new Set(occupants.map((animal) => animal.sex));
    const unresolvedCageNotes = getCageHealthNotes(cage.id).filter((note) => !note.resolved);

    if (occupants.length > cageMaxOccupancy) {
      alerts.push({
        id: `rule-cage-capacity-${cage.id}`,
        entityType: "cage",
        entityId: cage.id,
        alertType: "cage_overcapacity",
        severity: "critical",
        message: `${getCageLabel(cage.id)} holds ${occupants.length} active animals, above the configured occupancy limit.`,
        status: "open",
        generatedAt: data.today,
        source: "rule",
      });
    }

    if (!allowMixedSexHolding && cage.status !== "breeding" && sexes.has("male") && sexes.has("female")) {
      alerts.push({
        id: `rule-mixed-sex-${cage.id}`,
        entityType: "cage",
        entityId: cage.id,
        alertType: "mixed_sex_holding",
        severity: "critical",
        message: `${getCageLabel(cage.id)} is a non-breeding cage holding mixed-sex occupants.`,
        status: "open",
        generatedAt: data.today,
        source: "rule",
      });
    }

    unresolvedCageNotes.forEach((note) => {
      alerts.push({
        id: `rule-cage-note-${note.id}`,
        entityType: "cage",
        entityId: cage.id,
        alertType: "welfare_note",
        severity: note.severity,
        message: note.note,
        status: "open",
        generatedAt: note.createdAt,
        source: "rule",
      });
    });
  });

  data.experimentAssignments.forEach((assignment) => {
    if (
      assignment.status === "reserved" &&
      differenceInDays(parseISO(data.today), parseISO(assignment.startDate)) > reservationGrace
    ) {
      const experiment = getExperiment(assignment.experimentId);
      const animal = getAnimal(assignment.animalId);

      alerts.push({
        id: `rule-reserved-stale-${assignment.id}`,
        entityType: "experiment",
        entityId: assignment.experimentId,
        alertType: "reserved_not_started",
        severity: "warning",
        message: `${animal?.animalId ?? "Animal"} has been reserved for ${experiment?.experimentCode ?? "an experiment"} without starting.`,
        status: "open",
        generatedAt: data.today,
        source: "rule",
      });
    }
  });

  return alerts;
}

export function getAlerts() {
  return [...colonyData.manualAlerts, ...getBaseRuleAlerts(colonyData)].sort((left, right) =>
    compareDesc(parseISO(left.generatedAt), parseISO(right.generatedAt)),
  );
}

export function getAlertsForEntity(entityType: Alert["entityType"], entityId: string) {
  return getAlerts().filter((alert) => alert.entityType === entityType && alert.entityId === entityId);
}

function getAnimalWarnings(animalId: string) {
  return getAlertsForEntity("animal", animalId).map((alert) => alert.message);
}

export function getAnimalListItems(): AnimalListItem[] {
  return getActiveAnimals().map((animal) => {
    const assignments = getAnimalAssignments(animal.id)
      .map((assignment) => getExperiment(assignment.experimentId)?.experimentCode)
      .filter((value): value is string => Boolean(value));
    const projects = getAnimalProjects(animal.id).map((project) => project.projectCode);
    const genotypeConfirmed = isGenotypeConfirmed(animal.id);
    const activeExperiment = getAnimalAssignments(animal.id).some((assignment) => assignment.status === "active");
    const hasCriticalWarning = getAlertsForEntity("animal", animal.id).some(
      (alert) => alert.severity === "critical",
    );

    return {
      id: animal.id,
      animalId: animal.animalId,
      labId: animal.labId,
      sex: animal.sex,
      ageDays: getAnimalAgeDays(animal),
      ageLabel: getAnimalAgeLabel(animal),
      strain: getStrain(animal.strainId)?.name ?? "Unknown strain",
      genotypeSummary: getAnimalGenotypeSummary(animal.id),
      cageLabel: getCageLabel(animal.currentCageId),
      status: animal.status,
      projectCodes: projects,
      experimentSummary: assignments.join(", ") || "None",
      warnings: getAnimalWarnings(animal.id),
      genotypeConfirmed,
      availableForExperiment:
        animal.status === "colony_holding" && genotypeConfirmed && !activeExperiment && !hasCriticalWarning,
    };
  });
}

export function getCageListItems(): CageListItem[] {
  return colonyData.cages.map((cage) => {
    const occupants = getAnimalsForCage(cage.id);
    const room = getRoom(cage.roomId);
    const rack = getRack(cage.rackId);
    const sexComposition = occupants.length
      ? [
          occupants.filter((animal) => animal.sex === "male").length ? `${occupants.filter((animal) => animal.sex === "male").length}M` : "",
          occupants.filter((animal) => animal.sex === "female").length ? `${occupants.filter((animal) => animal.sex === "female").length}F` : "",
        ]
          .filter(Boolean)
          .join(" / ")
      : "Empty";
    const strainSummary = Array.from(
      new Set(occupants.map((animal) => getStrain(animal.strainId)?.name ?? "Unknown")),
    ).join(", ");

    return {
      id: cage.id,
      cageNumber: cage.cageNumber,
      roomNumber: room?.roomNumber ?? "?",
      rackNumber: rack?.rackNumber ?? "?",
      barcode: cage.barcode,
      status: cage.status,
      occupantCount: occupants.length,
      sexComposition,
      strainSummary: strainSummary || "No active occupants",
      warningCount: getAlertsForEntity("cage", cage.id).length,
    };
  });
}

function pairScore(animal: Animal, desiredGenotype: string) {
  const genotypeSummary = getAnimalGenotypeSummary(animal.id).toLowerCase();

  return desiredGenotype
    .toLowerCase()
    .split(/[;,]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .reduce((score, token) => (genotypeSummary.includes(token) ? score + 0.2 : score), 0);
}

export function getBreedingSuggestions(
  desiredGenotype = "Cre ; tdTomato",
  desiredSex: "male" | "female" = "female",
  minimumYield = 4,
): BreedingSuggestion[] {
  const males = getActiveAnimals().filter((animal) => animal.sex === "male");
  const females = getActiveAnimals().filter((animal) => animal.sex === "female");

  return males
    .flatMap((sire) =>
      females.map((dam) => {
        const sireAge = getAnimalAgeDays(sire);
        const damAge = getAnimalAgeDays(dam);
        const genotypeScore = Math.min(0.95, pairScore(sire, desiredGenotype) + pairScore(dam, desiredGenotype));
        const fertilityPenalty = sire.status === "breeding" && dam.status === "breeding" ? 0 : 0.08;
        const agePenalty = sireAge > getRuleNumber("breeder_max_age_days") || damAge > getRuleNumber("breeder_max_age_days") ? 18 : 0;
        const criticalPenalty =
          sireAge < getRuleNumber("breeder_min_age_days") || damAge < getRuleNumber("breeder_min_age_days")
            ? 40
            : 0;
        const warnings: string[] = [];

        if (sireAge > getRuleNumber("breeder_max_age_days")) {
          warnings.push(`${sire.animalId} exceeds breeder age threshold`);
        }

        if (damAge > getRuleNumber("breeder_max_age_days")) {
          warnings.push(`${dam.animalId} exceeds breeder age threshold`);
        }

        if (getAnimalGenotypeSummary(sire.id).includes("CreER +/-") && getAnimalGenotypeSummary(dam.id).includes("tdTomato +/-")) {
          warnings.push("Cross can yield desired dual-transgenic pups");
        }

        const expectedProbability = Math.max(0.1, genotypeScore - fertilityPenalty);
        const expectedUsablePups = Number((expectedProbability * 6).toFixed(1));
        const estimatedPupsNeeded = Math.max(6, Math.ceil(minimumYield / Math.max(expectedProbability, 0.1)));
        const priorityScore = Math.max(
          0,
          Math.round(expectedProbability * 100 + (desiredSex === "female" ? 5 : 0) - agePenalty - criticalPenalty),
        );

        return {
          id: `${sire.id}-${dam.id}`,
          sireId: sire.id,
          damId: dam.id,
          sireLabel: `${sire.animalId} (${getAnimalAgeLabel(sire)})`,
          damLabel: `${dam.animalId} (${getAnimalAgeLabel(dam)})`,
          expectedGenotypeProbability: expectedProbability,
          expectedSexSplit: "50% female / 50% male",
          estimatedPupsNeeded,
          expectedUsablePups,
          warnings,
          priorityScore,
        };
      }),
    )
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, 5);
}

export function getExperimentCandidates(
  desiredNumber = 4,
  desiredSex: "male" | "female" | "either" = "female",
  minAgeDays = 28,
  maxAgeDays = 140,
  genotypeKeyword = "Cre",
): ExperimentCandidate[] {
  return getAnimalListItems()
    .filter((animal) => animal.status === "colony_holding" || animal.status === "reserved")
    .filter((animal) => (desiredSex === "either" ? true : animal.sex === desiredSex))
    .filter((animal) => animal.ageDays >= minAgeDays && animal.ageDays <= maxAgeDays)
    .map((animal) => {
      const warnings = [...animal.warnings];
      const genotypeMatch = animal.genotypeSummary.toLowerCase().includes(genotypeKeyword.toLowerCase());
      const score =
        (animal.availableForExperiment ? 60 : 25) +
        (genotypeMatch ? 25 : 0) +
        (animal.sex === "female" ? 5 : 0) -
        warnings.length * 4;

      if (!genotypeMatch) {
        warnings.push("Genotype does not match the current experiment request");
      }

      return {
        animalId: animal.animalId,
        score,
        inclusionReason: animal.availableForExperiment
          ? "Eligible, genotype confirmed, and not in an active experiment"
          : "Included for review despite current blocker",
        warnings,
        cageLabel: animal.cageLabel,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, desiredNumber + 2);
}

export function getDashboardMetrics() {
  const activeAnimals = getActiveAnimals();
  const activeBreeders = activeAnimals.filter((animal) => animal.status === "breeding");
  const genotypePending = activeAnimals.filter((animal) =>
    getAnimalGenotypingRecords(animal.id).some((record) => record.status === "pending"),
  );
  const availableForExperiment = getAnimalListItems().filter((animal) => animal.availableForExperiment);
  const openAlerts = getAlerts().filter((alert) => alert.status === "open");

  return {
    activeAnimals: activeAnimals.length,
    activeBreeders: activeBreeders.length,
    pendingGenotypes: genotypePending.length,
    availableForExperiment: availableForExperiment.length,
    openAlerts: openAlerts.length,
    oldBreeders: activeBreeders.filter((animal) => getAnimalAgeDays(animal) > getRuleNumber("breeder_max_age_days")).length,
  };
}

export function getDashboardHighlights() {
  return {
    upcomingWean: colonyData.litters
      .filter((litter) => !litter.litterSizeWean)
      .map((litter) => ({
        litterId: litter.id,
        dueDate: formatDate(
          new Date(parseISO(litter.birthDate).getTime() + getRuleNumber("weaning_due_days") * 86_400_000).toISOString(),
        ),
        breedingId: litter.breedingSetupId,
      })),
    breeders: getActiveAnimals()
      .filter((animal) => animal.status === "breeding")
      .map((animal) => ({
        animalId: animal.animalId,
        ageLabel: getAnimalAgeLabel(animal),
        cageLabel: getCageLabel(animal.currentCageId),
      })),
    alerts: getAlerts().slice(0, 6),
  };
}

export function getAnimalTimeline(animalId: string) {
  const genotypeEvents = getAnimalGenotypingRecords(animalId).map((record) => ({
    id: `geno-${record.id}`,
    date: record.resultDate,
    label: `Genotype ${record.status}`,
    description: record.finalCall,
  }));
  const statusEvents = colonyData.animalStatusEvents
    .filter((event) => event.animalId === animalId)
    .map((event) => ({
      id: event.id,
      date: event.happenedAt,
      label: titleCase(event.toStatus),
      description: event.reason ?? "Status updated",
    }));
  const experimentEvents = getAnimalAssignments(animalId).map((assignment) => {
    const experiment = getExperiment(assignment.experimentId);

    return {
      id: assignment.id,
      date: assignment.startDate,
      label: `Experiment ${assignment.status}`,
      description: `${experiment?.experimentCode ?? "Experiment"}${assignment.treatmentGroup ? ` · ${assignment.treatmentGroup}` : ""}`,
    };
  });

  return [...genotypeEvents, ...statusEvents, ...experimentEvents].sort((left, right) =>
    compareDesc(parseISO(left.date), parseISO(right.date)),
  );
}

export function getColonyComposition() {
  const active = getActiveAnimals();

  return {
    males: active.filter((animal) => animal.sex === "male").length,
    females: active.filter((animal) => animal.sex === "female").length,
    breeding: active.filter((animal) => animal.status === "breeding").length,
    transgenic: active.filter((animal) => getAnimalAlleles(animal.id).some((allele) => allele.zygosity !== "WT/WT")).length,
  };
}

export function getBreedingOverview() {
  return colonyData.breedingSetups.map((setup) => {
    const adults = getBreedingAdults(setup.id);
    const litter = colonyData.litters.find((candidate) => candidate.breedingSetupId === setup.id);

    return {
      ...setup,
      adults,
      litter,
      ageDays: differenceInDays(parseISO(colonyData.today), parseISO(setup.startDate)),
    };
  });
}

export function getExperimentOverview() {
  return colonyData.experiments.map((experiment) => ({
    ...experiment,
    assignments: colonyData.experimentAssignments.filter(
      (assignment) => assignment.experimentId === experiment.id,
    ),
    project: getProject(experiment.projectId),
  }));
}

export function getRuleSummary() {
  return colonyData.ruleConfigs.map((rule) => ({
    ...rule,
    displayValue: Array.isArray(rule.value) ? rule.value.join("; ") : String(rule.value),
  }));
}

export function getRecentAuditLogs(limit = 8) {
  return [...colonyData.auditLogs]
    .sort((left, right) => compareDesc(parseISO(left.timestamp), parseISO(right.timestamp)))
    .slice(0, limit)
    .map((log) => ({
      ...log,
      actor: getUser(log.actorId),
    }));
}

export function getCageSnapshot(cageId: string) {
  const cage = getCage(cageId);

  if (!cage) {
    return null;
  }

  const occupants = getAnimalsForCage(cage.id);
  const room = getRoom(cage.roomId);
  const rack = getRack(cage.rackId);

  return {
    cage,
    room,
    rack,
    occupants,
    notes: getCageHealthNotes(cage.id),
    alerts: getAlertsForEntity("cage", cage.id),
    attachments: colonyData.attachments.filter((attachment) => attachment.cageId === cage.id),
  };
}

export function getAnimalSnapshot(animalId: string) {
  const animal = getAnimal(animalId);

  if (!animal) {
    return null;
  }

  return {
    animal,
    strain: getStrain(animal.strainId),
    cage: getCage(animal.currentCageId ?? ""),
    projects: getAnimalProjects(animal.id),
    assignments: getAnimalAssignments(animal.id).map((assignment) => ({
      ...assignment,
      experiment: getExperiment(assignment.experimentId),
    })),
    notes: getAnimalHealthNotes(animal.id),
    alerts: getAlertsForEntity("animal", animal.id),
    timeline: getAnimalTimeline(animal.id),
    genotypeSummary: getAnimalGenotypeSummary(animal.id),
    litter: getLitterForAnimal(animal.id),
    sire: animal.sireId ? getAnimal(animal.sireId) : null,
    dam: animal.damId ? getAnimal(animal.damId) : null,
  };
}

export function getRuleConfigIndex() {
  return colonyData.ruleConfigs.reduce<Record<string, RuleConfig>>((accumulator, rule) => {
    accumulator[rule.key] = rule;

    return accumulator;
  }, {});
}

export function describeOccupancy(cage: Cage) {
  const occupants = getAnimalsForCage(cage.id);

  if (!occupants.length) {
    return "No active occupants";
  }

  const sexes = [
    occupants.filter((animal) => animal.sex === "male").length,
    occupants.filter((animal) => animal.sex === "female").length,
  ];

  return `${occupants.length} occupants · ${sexes[0]} male · ${sexes[1]} female`;
}

export function getTopAlerts(limit = 5) {
  return getAlerts().slice(0, limit);
}

export function getSuggestionSummary() {
  return getBreedingSuggestions().map((suggestion) => ({
    ...suggestion,
    probabilityLabel: formatPercent(suggestion.expectedGenotypeProbability),
  }));
}
