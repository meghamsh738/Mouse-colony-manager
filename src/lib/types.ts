export type UserRole =
  | "it_head"
  | "facility_admin"
  | "cmu_staff"
  | "lab_user"
  | "admin"
  | "colony_manager"
  | "animal_staff"
  | "researcher"
  | "read_only";

export type CanonicalUserRole = "it_head" | "facility_admin" | "cmu_staff" | "lab_user";

export type LabMembershipRole = "owner" | "manager" | "staff" | "viewer";
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";
export type PrivilegedRoleChangeStatus = "pending" | "approved" | "rejected" | "expired";
export type FacilityDuty =
  | "designated_veterinarian"
  | "welfare_officer"
  | "protocol_reviewer"
  | "training_administrator"
  | "billing_administrator"
  | "data_steward";
export type IdentityAssuranceLevel = "password" | "mfa" | "phishing_resistant" | "synthetic_mfa";
export type InvoiceStatus = "draft" | "finalized" | "void";

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
export type AnimalIntakeDisposition = "holding" | "quarantine";
export type BreedingAdultRole = "sire" | "dam" | "support";
export type RuleCategory =
  | "breeding"
  | "welfare"
  | "compliance"
  | "genotype"
  | "experiment"
  | "capacity";
export type RuleConfigValue =
  | string
  | number
  | boolean
  | RuleConfigValue[]
  | {
      [key: string]: RuleConfigValue;
    };
export type NotificationCategoryKey =
  | "genotype_pending"
  | "weaning_due"
  | "breeder_age"
  | "welfare"
  | "reservation_drift"
  | "invoice"
  | "sop"
  | "transfer"
  | "cryostorage"
  | "strain_directory"
  | "system";
export type NotificationDeliveryChannel = "in_app";

export interface SeedUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  active: boolean;
}

export interface Lab {
  id: string;
  name: string;
  code: string;
  billingContact?: string;
  notes?: string;
  active?: boolean;
}

export interface LabMembership {
  id: string;
  labId: string;
  userId: string;
  role: LabMembershipRole;
  active?: boolean;
}

export interface Facility {
  id: string;
  name: string;
  cageBarcodePrefix?: string;
  maxCageOccupancy?: number;
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
  labId?: string;
  roomId: string;
  rackId: string;
  cageNumber: string;
  barcode: string;
  capacityOverride?: number;
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
  owningLabId?: string;
  intakeBatchId?: string;
  sourceAnimalId?: string;
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

export interface AnimalIntakeBatch {
  id: string;
  labId: string;
  vendor: string;
  orderReference: string;
  arrivalDate: string;
  disposition: AnimalIntakeDisposition;
  notes?: string;
  createdById: string;
  createdAt?: string;
}

export type CageDestinationRef =
  | { kind: "existing"; cageId: string }
  | { kind: "new"; clientId: string };

export interface CageDraft {
  clientId: string;
  labId: string;
  roomId: string;
  rackId: string;
  cageNumber: string;
  barcode?: string;
  capacityOverride?: number | null;
  status: Exclude<CageStatus, "closed" | "retired">;
  chargeCategoryId?: string;
  startDate: string;
  notes?: string;
}

export interface AnimalAssignmentDraft {
  subjectId: string;
  destination: CageDestinationRef;
}

export interface CageAssignmentPlan {
  cages: CageDraft[];
  assignments: AnimalAssignmentDraft[];
  movedAt: string;
  reason: string;
}

export interface AnimalIntakeRow {
  rowId: string;
  sourceAnimalId?: string;
  sex: Sex;
  strainId: string;
  dob: string;
  healthNotes?: string;
  destination: CageDestinationRef;
}

export interface IntakeCageOption {
  id: string;
  barcode: string;
  label: string;
  labId: string;
  status: CageStatus;
  occupantCount: number;
  capacity: number;
  remainingCapacity: number;
  sexComposition: string;
  strainSummary: string;
}

export interface CageIntakeOptionsView {
  labs: LabOption[];
  facilities: Array<{
    id: string;
    name: string;
    barcodePrefix: string;
    maxCageOccupancy: number;
  }>;
  rooms: Array<{ id: string; facilityId: string; roomNumber: string }>;
  racks: Array<{ id: string; roomId: string; rackNumber: string }>;
  strains: Array<{ id: string; name: string }>;
  chargeCategories: ChargeCategoryOption[];
  existingCages: IntakeCageOption[];
  movableAnimals: Array<{
    id: string;
    animalId: string;
    labId: string;
    owningLabId?: string | null;
    sex: Sex;
    strain: string;
    currentCageId: string;
    currentCageBarcode: string;
  }>;
  litter?: {
    id: string;
    version: number;
    birthDate: string;
    litterSizeBirth: number;
    daysOld: number;
    weaningDueDays: number;
    suggestedWeanDate: string;
    alreadyWeaned: boolean;
  } | null;
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
  experimentId?: string;
  sampleLabel: string;
  sampleType: string;
  status: SampleStatus;
  collectedAt: string;
  storageLocation?: string;
  quantityLabel?: string;
  notes?: string;
  createdById?: string;
  createdAt?: string;
  version?: number;
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

export interface CageChargeCategory {
  id: string;
  name: string;
  code: string;
  dailyRateCents: number;
  currencyCode?: string;
  active?: boolean;
  notes?: string;
}

export interface CageChargePeriod {
  id: string;
  cageId: string;
  labId: string;
  categoryId: string;
  dailyRateCents: number;
  currencyCode?: string;
  startedAt: string;
  endedAt?: string;
  notes?: string;
}

export interface CageLabTransfer {
  id: string;
  cageId: string;
  fromLabId: string;
  toLabId: string;
  movedById?: string;
  movedAt: string;
  reason?: string;
}

export interface AnimalLabTransfer {
  id: string;
  animalId: string;
  fromLabId: string;
  toLabId: string;
  movedById?: string;
  movedAt: string;
  reason?: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  finalNumber?: string;
  labId: string;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  currencyCode?: string;
  subtotalCents: number;
  adjustmentTotalCents?: number;
  totalCents?: number;
  finalizedAt?: string;
  finalizedById?: string;
  voidedAt?: string;
  voidedById?: string;
  voidReason?: string;
}

export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  cageId: string;
  chargePeriodId: string;
  categoryId: string;
  description: string;
  serviceStart: string;
  serviceEnd: string;
  dayCount: number;
  dailyRateCents: number;
  amountCents: number;
}

export interface RuleConfig {
  id: string;
  key: string;
  label: string;
  category: RuleCategory;
  valueType: "number" | "boolean" | "text" | "json";
  value: RuleConfigValue;
  description: string;
  criticalBlock: boolean;
}

export interface Alert {
  id: string;
  labId?: string | null;
  entityType: "animal" | "cage" | "litter" | "experiment" | "project" | "invoice";
  entityId: string;
  alertType: string;
  severity: AlertSeverity;
  message: string;
  status: AlertStatus;
  generatedAt: string;
  resolvedAt?: string;
  source: "rule" | "manual" | "billing";
}

export interface NotificationPreference {
  id: string | null;
  version: number;
  ruleKey: string;
  categoryKey: NotificationCategoryKey;
  categoryLabel: string;
  description: string;
  enabled: boolean;
  inAppEnabled: boolean;
  emailAllowed: boolean;
  emailMode: "off" | "daily_digest" | "weekly_digest";
  digestHourUtc: number;
  digestDayOfWeek: number;
  urgentAlwaysOn: boolean;
  matchingAlertCount: number;
}

export interface NotificationDeliveryHistoryItem {
  id: string;
  categoryKey: NotificationCategoryKey;
  kind: "immediate" | "digest";
  status: "queued" | "delivered" | "failed" | "cancelled";
  scheduledFor: string;
  deliveredAt: string | null;
  attemptCount: number;
  lastError: string | null;
}

export interface NotificationItem {
  id: string;
  recipientId: string;
  version: number;
  labId: string | null;
  categoryKey: NotificationCategoryKey;
  categoryLabel: string;
  description: string;
  deliveryChannel: NotificationDeliveryChannel;
  severity: AlertSeverity;
  message: string;
  generatedAt: string;
  source: "rule" | "manual" | "billing";
  alertType: string;
  entityType: string;
  entityId: string;
  targetLabel: string;
  href: string;
  actionLabel: string;
  urgent: boolean;
  readAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface NotificationInboxView {
  notifications: NotificationItem[];
  preferences: NotificationPreference[];
  deliveryHistory: NotificationDeliveryHistoryItem[];
  summary: {
    total: number;
    unread: number;
    acknowledged: number;
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
  labs: Lab[];
  labMemberships: LabMembership[];
  facilities: Facility[];
  rooms: Room[];
  racks: Rack[];
  cages: Cage[];
  strains: Strain[];
  alleles: Allele[];
  animals: Animal[];
  animalIntakeBatches: AnimalIntakeBatch[];
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
  cageChargeCategories: CageChargeCategory[];
  cageChargePeriods: CageChargePeriod[];
  cageLabTransfers: CageLabTransfer[];
  animalLabTransfers: AnimalLabTransfer[];
  invoices: Invoice[];
  invoiceLineItems: InvoiceLineItem[];
  ruleConfigs: RuleConfig[];
  manualAlerts: Alert[];
  auditLogs: AuditLog[];
}

export interface AnimalListItem {
  id: string;
  animalId: string;
  labId: string;
  owningLabId?: string | null;
  owningLabName?: string | null;
  sex: Sex;
  ageDays: number;
  ageLabel: string;
  dob: string;
  healthStatus?: string | null;
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
  roomId: string;
  cageNumber: string;
  roomNumber: string;
  rackNumber: string;
  barcode: string;
  labId?: string | null;
  labName?: string | null;
  labCode?: string | null;
  status: CageStatus;
  active: boolean;
  occupantCount: number;
  capacity: number;
  remainingCapacity: number;
  capacityOverride?: number | null;
  animalIdentifiers: string[];
  animalLabIdentifiers: string[];
  sexComposition: string;
  strainSummary: string;
  projectSummary: string;
  chargeCategoryId?: string | null;
  chargeCategoryName?: string | null;
  dailyRateCents?: number | null;
  currencyCode?: string | null;
  chargeState: "chargeable" | "exited" | "unpriced";
  billingCutoffAt?: string | null;
  warningCount: number;
  warningMessages: string[];
  animals: Array<{
    id: string;
    animalId: string;
    labAnimalId: string;
    sex: string;
    dob: string;
    status: AnimalStatus;
    healthStatus: string | null;
    strain: string;
    genotype: string;
    projectCodes: string[];
  }>;
}

export interface LabOption {
  id: string;
  name: string;
  code: string;
}

export interface ChargeCategoryOption {
  id: string;
  name: string;
  code: string;
  dailyRateCents: number;
  currencyCode: string;
  active: boolean;
}

export interface CageLabelPrintItem {
  id: string;
  barcode: string;
  locationLabel: string;
  status: CageStatus;
  occupantCount: number;
  sexComposition: string;
  strainSummary: string;
  warningCount: number;
}

export interface CageLabelPrintView {
  labels: CageLabelPrintItem[];
  printedAt: string;
  total: number;
}

export interface AnimalTransferOption {
  id: string;
  version: number;
  animalId: string;
  labId: string;
  owningLabId: string;
  owningLabName?: string | null;
  owningLabCode?: string | null;
  sex: Sex;
  status: AnimalStatus;
  healthStatus: string;
  strain: string;
  currentCageId: string;
  currentCageBarcode: string;
  currentCageLabel: string;
}

export interface CageTransferOption {
  id: string;
  labId: string;
  barcode: string;
  label: string;
  status: CageStatus;
  labName?: string | null;
  labCode?: string | null;
  occupantCount: number;
  capacity: number;
  remainingCapacity: number;
  maleCount: number;
  femaleCount: number;
  sexComposition: string;
  strainSummary: string;
  warningCount: number;
}

export interface AnimalTransferWorkspaceView {
  commandNonce: string;
  defaultDestinationCageId: string;
  defaultDate: string;
  rules: {
    cageMaxOccupancy: number;
    mixedSexHoldingAllowed: boolean;
  };
  animalOptions: AnimalTransferOption[];
  cageOptions: CageTransferOption[];
  pinnedDestination?: CageTransferOption;
  animalResults: TransferResultPage;
  destinationResults: TransferResultPage;
  query: AnimalTransferWorkspaceQuery;
}

export interface TransferResultPage {
  totalCount: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export interface AnimalTransferWorkspaceQuery {
  animalSearch: string;
  animalPage: number;
  destinationSearch: string;
  destinationPage: number;
  pageSize: number;
}

export interface AnimalPresenceCagePageView extends TransferResultPage {
  items: CageTransferOption[];
  search: string;
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
  estimatedSurplusPups: number;
  expectedLitterSize: number;
  fertilitySummary: string;
  lineFertilitySummary: string;
  workloadSummary: string;
  warnings: string[];
  ruleSeverity: "ok" | "warning" | "critical";
  ruleSummary: string;
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
  ageBand: string;
  strain: string;
  genotypeSummary: string;
  projectCodes: string[];
  chargeableProjectCodes: string[];
  activeProjectCount: number;
  allocationRisk: "none" | "unallocated" | "multi_project";
  allocationSummary: string;
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
  balanceByAge: boolean;
  maxSameCagePerGroup: number;
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
  exampleAnimalIds: string[];
  severity: "info" | "warning";
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
        ageDays: number;
        ageLabel: string;
        ageBand: string;
        cageLabel: string;
        genotypeSummary: string;
        siblingGroup: string;
      }>;
      summary: {
        total: number;
        males: number;
        females: number;
        averageAgeDays: number;
        cageCount: number;
      };
      constraintWarnings: string[];
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
    allocationWarnings: number;
    multiProjectCandidates: number;
    unallocatedCandidates: number;
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
  animalLabCode?: string;
  labId: string;
  projectCode?: string | null;
  experimentId?: string | null;
  experimentCode?: string | null;
  storageLocation?: string | null;
  quantityLabel?: string | null;
  notes?: string | null;
  version: number;
}

export interface CryostorageInventoryItem {
  id: string;
  labId: string;
  labLabel: string;
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
  version: number;
}

export interface CryostorageRequestItem {
  id: string;
  labId: string;
  labLabel: string;
  requestType: "store" | "recover" | "discard";
  status: "submitted" | "completed" | "rejected" | "cancelled";
  version: number;
  requestedFor: string;
  requestedAt: string;
  requestedById: string;
  requestedByLabel: string;
  targetRecordId: string | null;
  targetRecordVersion: number | null;
  targetRecordLabel: string | null;
  targetRecordStatus: CryostorageStatus | null;
  strainName: string | null;
  projectCode: string | null;
  sampleLabel: string | null;
  materialType: string | null;
  requestedQuantityLabel: string | null;
  requestedStorageLocation: string | null;
  notes: string | null;
  decidedAt: string | null;
  decidedByLabel: string | null;
  decisionReason: string | null;
  operation: {
    recordId: string;
    previousStatus: CryostorageStatus | null;
    resultingStatus: CryostorageStatus;
    performedAt: string;
    storageLocation: string | null;
    quantityLabel: string | null;
    notes: string | null;
  } | null;
}

export interface BreedingForecastItem {
  id: string;
  labId: string;
  labLabel: string;
  pairLabel: string;
  cageIds: string[];
  cageLabels: string[];
  responsibleUserIds: string[];
  responsibleUserNames: string[];
  targetGenotype: string;
  projectedNextLitterDate: string;
  projectedExperimentReadyDate: string;
  expectedLitterSize: number;
  expectedUsablePups: number;
  expectedSurplusPups: number;
  expectedProbability: number;
  lineFertilitySummary: string;
  warnings: string[];
}

export interface ForecastDemandItem {
  experimentId: string;
  labId: string;
  labLabel: string;
  experimentCode: string;
  projectCode: string;
  title: string;
  startDate: string;
  requestedAnimals: number;
  plannedAnimals: number;
  reservedAnimals: number;
  activeAnimals: number;
  supplyGap: number;
  cageIds: string[];
  cageLabels: string[];
  responsibleUserIds: string[];
  responsibleUserNames: string[];
}

export interface SurplusMinimizationView {
  horizonDays: number;
  demandAnimals: number;
  availableSupply: number;
  projectedUsableSupply: number;
  projectedSurplusPups: number;
  supplyGap: number;
  surplusAfterDemand: number;
  demandItems: ForecastDemandItem[];
  recommendations: string[];
}

export interface ForecastSummary {
  projectedPups30Days: number;
  projectedExperimentReady45Days: number;
  pendingDemand45Days: number;
  projectedSurplus45Days: number;
  supplyGap45Days: number;
  longRangeHorizonDays: number;
  projectedExperimentReadyLongRangeDays: number;
  pendingDemandLongRangeDays: number;
  projectedSurplusLongRangeDays: number;
  supplyGapLongRangeDays: number;
  activeBreedingForecasts: number;
  cryostorageBackups: number;
  availableNow: number;
  reservedPressure: number;
}
