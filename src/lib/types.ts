export type UserRole =
  | "admin"
  | "colony_manager"
  | "animal_staff"
  | "researcher"
  | "read_only";

export type Sex = "male" | "female" | "unknown";

export type CageStatus =
  | "active"
  | "breeding"
  | "quarantine"
  | "experiment"
  | "retired"
  | "closed";

export type AnimalStatus =
  | "planned"
  | "born"
  | "nursing"
  | "weaned"
  | "colony_holding"
  | "breeding"
  | "reserved"
  | "in_experiment"
  | "experiment_completed"
  | "euthanized"
  | "dead"
  | "transferred_out"
  | "archived";

export type OutcomeStatus =
  | "alive"
  | "euthanized"
  | "dead"
  | "transferred"
  | "missing";

export type ExperimentStatus = "planned" | "active" | "completed" | "cancelled";

export type AssignmentStatus =
  | "planned"
  | "reserved"
  | "active"
  | "completed"
  | "cancelled";

export type HealthNoteType =
  | "routine_welfare"
  | "adverse_effect"
  | "veterinary_concern"
  | "breeding_concern"
  | "underweight"
  | "overweight"
  | "grooming_issue"
  | "aggression"
  | "pregnancy_suspicion"
  | "delivery_observed"
  | "post_procedure_monitoring";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved";
export type GenotypeCallStatus = "pending" | "provisional" | "confirmed" | "conflict";
export type SampleStatus = "collected" | "stored" | "allocated" | "consumed" | "discarded";
export type CryostorageStatus = "stored" | "reserved" | "recovered" | "depleted" | "discarded";
export type BreedingStatus = "planned" | "active" | "paused" | "retired" | "failed";
export type BreedingAdultRole = "sire" | "dam" | "support";
export type RuleCategory =
  | "breeding"
  | "welfare"
  | "compliance"
  | "genotype"
  | "experiment"
  | "capacity";
export type NotificationCategoryKey =
  | "genotype_pending"
  | "weaning_due"
  | "breeder_age"
  | "welfare"
  | "reservation_drift";
export type NotificationDeliveryChannel = "in_app";

export interface SeedUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  active: boolean;
}

export interface Facility {
  id: string;
  name: string;
  notes?: string;
}

export interface Room {
  id: string;
  facilityId: string;
  roomNumber: string;
  notes?: string;
}

export interface Rack {
  id: string;
  roomId: string;
  rackNumber: string;
  notes?: string;
}

export interface Cage {
  id: string;
  roomId: string;
  rackId: string;
  cageNumber: string;
  barcode: string;
  status: CageStatus;
  notes?: string;
  welfareFlags: string[];
  lastUpdatedAt: string;
}

export interface Strain {
  id: string;
  name: string;
  background: string;
  notes?: string;
  maintenanceRules?: string;
}

export interface Allele {
  id: string;
  name: string;
  gene: string;
  type: string;
  notes?: string;
  harmfulHomozygous?: boolean;
  maintainAsHet?: boolean;
  prohibitedPairings?: string[];
}

export interface Animal {
  id: string;
  animalId: string;
  labId: string;
  sex: Sex;
  dob: string;
  strainId: string;
  currentCageId: string | null;
  status: AnimalStatus;
  originType: string;
  sireId?: string;
  damId?: string;
  breedingGeneration?: string;
  healthStatus: string;
  projectSummary?: string;
  experimentalStatus: string;
  outcomeStatus: OutcomeStatus;
  deathDate?: string;
  deathReason?: string;
  notes?: string;
}

export interface AnimalAllele {
  id: string;
  animalId: string;
  alleleId: string;
  zygosity: string;
  callStatus: GenotypeCallStatus;
}

export interface GenotypingRecord {
  id: string;
  animalId: string;
  sourceType: string;
  assayType: string;
  sampleId?: string;
  markerTested: string;
  resultText: string;
  attachmentUrl?: string;
  sampleDate: string;
  resultDate: string;
  operatorId?: string;
  provider?: string;
  verifiedById?: string;
  finalCall: string;
  status: GenotypeCallStatus;
  confidence?: string;
}

export interface SampleRecord {
  id: string;
  animalId: string;
  projectId?: string;
  sampleLabel: string;
  sampleType: string;
  status: SampleStatus;
  collectedAt: string;
  storageLocation?: string;
  quantityLabel?: string;
  notes?: string;
  createdById?: string;
  createdAt?: string;
}

export interface CryostorageRecord {
  id: string;
  strainId: string;
  projectId?: string;
  sampleLabel: string;
  materialType: string;
  status: CryostorageStatus;
  storedAt: string;
  storageLocation?: string;
  quantityLabel?: string;
  recoveryNotes?: string;
  notes?: string;
  createdById?: string;
  createdAt?: string;
}

export interface BreedingSetup {
  id: string;
  startDate: string;
  endDate?: string;
  status: BreedingStatus;
  targetGenotype: string;
  targetSex?: Sex;
  notes?: string;
}

export interface BreedingAdult {
  id: string;
  breedingSetupId: string;
  animalId: string;
  role: BreedingAdultRole;
}

export interface Litter {
  id: string;
  breedingSetupId: string;
  birthDate: string;
  litterSizeBirth: number;
  litterSizeWean?: number;
  notes?: string;
}

export interface LitterAnimal {
  id: string;
  litterId: string;
  animalId: string;
}

export interface Project {
  id: string;
  projectCode: string;
  title: string;
  ownerId: string;
  notes?: string;
}

export interface AnimalProjectAllocation {
  id: string;
  animalId: string;
  projectId: string;
  startedAt: string;
  endedAt?: string;
  chargeable: boolean;
  notes?: string;
}

export interface Experiment {
  id: string;
  experimentCode: string;
  projectId: string;
  title: string;
  ownerId: string;
  status: ExperimentStatus;
  notes?: string;
}

export interface ExperimentAssignment {
  id: string;
  animalId: string;
  experimentId: string;
  status: AssignmentStatus;
  startDate: string;
  endDate?: string;
  treatmentGroup?: string;
  notes?: string;
  isPrimary: boolean;
}

export interface HealthNote {
  id: string;
  animalId?: string;
  cageId?: string;
  noteType: HealthNoteType;
  severity: AlertSeverity;
  note: string;
  followupRequired: boolean;
  actionTaken?: string;
  resolved: boolean;
  createdById: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  animalId?: string;
  cageId?: string;
  healthNoteId?: string;
  genotypingRecordId?: string;
  label: string;
  fileName: string;
  fileType: string;
  storageUrl: string;
}

export interface AnimalStatusEvent {
  id: string;
  animalId: string;
  fromStatus?: AnimalStatus;
  toStatus: AnimalStatus;
  happenedAt: string;
  actorId?: string;
  reason?: string;
}

export interface AnimalMovement {
  id: string;
  animalId: string;
  fromCageId?: string;
  toCageId?: string;
  movedById?: string;
  movedAt: string;
  reason?: string;
}

export interface CageMovement {
  id: string;
  cageId: string;
  fromLocation: string;
  toLocation: string;
  movedById?: string;
  movedAt: string;
  reason?: string;
}

export interface RuleConfig {
  id: string;
  key: string;
  label: string;
  category: RuleCategory;
  valueType: "number" | "boolean" | "text" | "json";
  value: number | boolean | string | string[];
  description: string;
  criticalBlock: boolean;
}

export interface Alert {
  id: string;
  entityType: "animal" | "cage" | "litter" | "experiment" | "project";
  entityId: string;
  alertType: string;
  severity: AlertSeverity;
  message: string;
  status: AlertStatus;
  generatedAt: string;
  resolvedAt?: string;
  source: "rule" | "manual";
}

export interface NotificationPreference {
  ruleKey: string;
  categoryKey: NotificationCategoryKey;
  categoryLabel: string;
  description: string;
  enabled: boolean;
  matchingAlertCount: number;
}

export interface NotificationItem {
  id: string;
  categoryKey: NotificationCategoryKey;
  categoryLabel: string;
  description: string;
  deliveryChannel: NotificationDeliveryChannel;
  severity: AlertSeverity;
  message: string;
  generatedAt: string;
  source: "rule" | "manual";
  alertType: string;
  entityType: string;
  entityId: string;
  href: string;
  actionLabel: string;
}

export interface NotificationInboxView {
  notifications: NotificationItem[];
  preferences: NotificationPreference[];
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    enabledCategories: number;
    mutedCategories: number;
  };
}

export interface AuditLog {
  id: string;
  actorId?: string;
  entityType: string;
  entityId: string;
  action: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  timestamp: string;
}

export interface SeedColonyData {
  today: string;
  users: SeedUser[];
  facilities: Facility[];
  rooms: Room[];
  racks: Rack[];
  cages: Cage[];
  strains: Strain[];
  alleles: Allele[];
  animals: Animal[];
  animalAlleles: AnimalAllele[];
  genotypingRecords: GenotypingRecord[];
  breedingSetups: BreedingSetup[];
  breedingAdults: BreedingAdult[];
  litters: Litter[];
  litterAnimals: LitterAnimal[];
  projects: Project[];
  projectAllocations: AnimalProjectAllocation[];
  experiments: Experiment[];
  experimentAssignments: ExperimentAssignment[];
  sampleRecords: SampleRecord[];
  cryostorageRecords: CryostorageRecord[];
  healthNotes: HealthNote[];
  attachments: Attachment[];
  animalStatusEvents: AnimalStatusEvent[];
  animalMovements: AnimalMovement[];
  cageMovements: CageMovement[];
  ruleConfigs: RuleConfig[];
  manualAlerts: Alert[];
  auditLogs: AuditLog[];
}

export interface AnimalListItem {
  id: string;
  animalId: string;
  labId: string;
  sex: Sex;
  ageDays: number;
  ageLabel: string;
  strain: string;
  genotypeSummary: string;
  cageLabel: string;
  status: AnimalStatus;
  projectCodes: string[];
  experimentSummary: string;
  warnings: string[];
  genotypeConfirmed: boolean;
  availableForExperiment: boolean;
}

export interface CageListItem {
  id: string;
  cageNumber: string;
  roomNumber: string;
  rackNumber: string;
  barcode: string;
  status: CageStatus;
  occupantCount: number;
  sexComposition: string;
  strainSummary: string;
  warningCount: number;
}

export interface BreedingSuggestion {
  id: string;
  sireId: string;
  damId: string;
  sireLabel: string;
  damLabel: string;
  expectedGenotypeProbability: number;
  expectedSexSplit: string;
  estimatedPupsNeeded: number;
  expectedUsablePups: number;
  warnings: string[];
  priorityScore: number;
}

export interface ExperimentCandidate {
  animalId: string;
  score: number;
  inclusionReason: string;
  warnings: string[];
  cageLabel: string;
  sex: Sex;
  ageDays: number;
  ageLabel: string;
  strain: string;
  genotypeSummary: string;
  projectCodes: string[];
  siblingGroup: string;
}

export interface ExperimentPlannerFilters {
  desiredNumber: number;
  desiredSex: "male" | "female" | "either";
  minAgeDays: number;
  maxAgeDays: number;
  genotypeKeyword: string;
  strainId?: string;
  projectId?: string;
  includeReserved: boolean;
  allowOverlap: boolean;
  balanceByCage: boolean;
  avoidSiblingClustering: boolean;
  groupCount: number;
  randomSeed: string;
  blockBySex: boolean;
  blockBySiblingGroup: boolean;
}

export interface ExperimentGroupSuggestion {
  animalId: string;
  rank: number;
  adjustedScore: number;
  reasons: string[];
}

export interface ExperimentExclusionSummary {
  reason: string;
  count: number;
}

export interface ExperimentPlannerView {
  filters: ExperimentPlannerFilters;
  candidates: ExperimentCandidate[];
  selected: ExperimentGroupSuggestion[];
  alternates: ExperimentGroupSuggestion[];
  randomization: {
    groups: Array<{
      name: string;
      members: Array<{
        animalId: string;
        sex: Sex;
        ageLabel: string;
        cageLabel: string;
        genotypeSummary: string;
        siblingGroup: string;
      }>;
      summary: {
        total: number;
        males: number;
        females: number;
      };
    }>;
    seed: string;
    strategy: string[];
  };
  exclusions: ExperimentExclusionSummary[];
  summary: {
    totalReviewed: number;
    included: number;
    selected: number;
    alternates: number;
    excluded: number;
  };
}

export interface SampleInventoryItem {
  id: string;
  sampleLabel: string;
  sampleType: string;
  status: SampleStatus;
  collectedAt: string;
  animalId: string;
  animalCode: string;
  labId: string;
  projectCode?: string | null;
  storageLocation?: string | null;
  quantityLabel?: string | null;
  notes?: string | null;
}

export interface CryostorageInventoryItem {
  id: string;
  sampleLabel: string;
  materialType: string;
  status: CryostorageStatus;
  storedAt: string;
  strainId: string;
  strainName: string;
  projectCode?: string | null;
  storageLocation?: string | null;
  quantityLabel?: string | null;
  recoveryNotes?: string | null;
  notes?: string | null;
}

export interface BreedingForecastItem {
  id: string;
  pairLabel: string;
  targetGenotype: string;
  projectedNextLitterDate: string;
  projectedExperimentReadyDate: string;
  expectedLitterSize: number;
  expectedUsablePups: number;
  expectedProbability: number;
  warnings: string[];
}

export interface ForecastSummary {
  projectedPups30Days: number;
  projectedExperimentReady45Days: number;
  activeBreedingForecasts: number;
  cryostorageBackups: number;
  availableNow: number;
  reservedPressure: number;
}
