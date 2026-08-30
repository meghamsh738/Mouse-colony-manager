import { differenceInDays } from "date-fns";

import { normalizeUserRole, type Capability } from "@/lib/capabilities";
import { getActorLabScope, type LabActor } from "@/lib/lab-access";
import type { AlertSeverity } from "@/lib/types";
import { formatAgeLabel, formatDate } from "@/lib/utils";
import { getCageListView } from "@/lib/cages-read";
import { getAnimalListView } from "@/lib/animals-read";
import { getBreedingOverviewView, getWeaningDueDays } from "@/lib/breeding-read";
import { getExperimentOverviewView } from "@/lib/experiments-read";
import { getSampleInventoryView } from "@/lib/samples-read";
import { getCryostorageInventoryView } from "@/lib/cryostorage-read";
import { getDashboardAlertsView } from "@/lib/dashboard-read";
export { workbookAppHref, workbookStateHref } from "@/lib/workbook-state";

type WorkbookActor = LabActor & {
  canonicalRole?: ReturnType<typeof normalizeUserRole>;
  capabilities?: readonly Capability[];
};

function canReadExperiments(actor: WorkbookActor) {
  if (actor.capabilities) return actor.capabilities.includes("experiments:full");
  return (actor.canonicalRole ?? normalizeUserRole(actor.role)) !== "cmu_staff";
}

function canReadBiosamples(actor: WorkbookActor) {
  if (actor.capabilities) return actor.capabilities.includes("biosamples:read");
  const role = actor.canonicalRole ?? normalizeUserRole(actor.role);
  return role === "facility_admin" || role === "lab_user";
}

export const WORKBOOK_SECTIONS = [
  "overview",
  "rooms",
  "breeding",
  "experiments",
  "biosamples",
  "cryostorage",
] as const;

export type WorkbookSection = (typeof WORKBOOK_SECTIONS)[number];
export type WorkbookDirection = "asc" | "desc";

export type WorkbookState = {
  section: WorkbookSection;
  sheet: string;
  search: string;
  sort: string;
  direction: WorkbookDirection;
  history: boolean;
  labId?: string;
};

export type WorkbookChildSheet = {
  id: string;
  label: string;
  count?: number;
};

export type WorkbookNavigation = {
  allowedSections: WorkbookSection[];
  childSheets: WorkbookChildSheet[];
  canFilterLabs: boolean;
  labs: Array<{ id: string; label: string }>;
};

export type WorkbookOverviewSheet = {
  kind: "overview";
  metrics: Array<{ label: string; value: number; href: string }>;
  alerts: Array<{
    id: string;
    severity: AlertSeverity;
    message: string;
    context: string;
    href: string;
  }>;
  dueWeaning: Array<{
    id: string;
    setupId: string;
    birthDate: string;
    ageDays: number;
    litterSize: number;
    href: string;
    correction: { requestId: string; appliedAt: string } | null;
  }>;
  activeWork: Array<{
    id: string;
    type: "Breeding" | "Experiment";
    title: string;
    status: string;
    detail: string;
    href: string;
  }>;
};

export type WorkbookAnimalRow = {
  id: string;
  animalId: string;
  labAnimalId: string;
  sex: string;
  dob: string;
  age: string;
  strain: string;
  genotype: string;
  project: string;
  health: string;
  status: string;
};

export type WorkbookRoomGroup = {
  id: string;
  barcode: string;
  location: string;
  roomId: string | null;
  room: string;
  rack: string;
  cageNumber: string;
  lab: string;
  status: string;
  occupancy: string;
  strain: string;
  sexMix: string;
  warnings: string[];
  charge: string;
  animals: WorkbookAnimalRow[];
};

export type WorkbookRoomsSheet = {
  kind: "rooms";
  groups: WorkbookRoomGroup[];
};

export type WorkbookLitterRow = {
  id: string;
  birthDate: string;
  age: string;
  born: number;
  weaned: number | null;
  progeny: Array<{ id: string; animalId: string; sex: string; status: string }>;
  correction: { requestId: string; appliedAt: string } | null;
};

export type WorkbookBreedingRow = {
  id: string;
  lineId: string;
  line: string;
  status: string;
  sire: { id: string; animalId: string; genotype: string } | null;
  dam: { id: string; animalId: string; genotype: string } | null;
  targetGenotype: string;
  startDate: string;
  startDateSort: number;
  age: string;
  latestLitter: string;
  weaning: string;
  progenyCount: number;
  cautions: string[];
  litters: WorkbookLitterRow[];
};

export type WorkbookBreedingSheet = {
  kind: "breeding";
  rows: WorkbookBreedingRow[];
};

export type WorkbookExperimentAssignment = {
  id: string;
  animalId: string;
  animalRecordId: string;
  sex: string;
  strain: string;
  genotype: string;
  cage: string;
  status: string;
  startDate: string;
  notes: string;
};

export type WorkbookExperimentGroup = {
  id: string;
  experimentId: string;
  experimentCode: string;
  title: string;
  project: string;
  status: string;
  treatmentGroup: string;
  assignments: WorkbookExperimentAssignment[];
};

export type WorkbookExperimentsSheet = {
  kind: "experiments";
  groups: WorkbookExperimentGroup[];
};

export type WorkbookBiosampleRow = {
  id: string;
  sampleLabel: string;
  type: string;
  status: string;
  animalId: string;
  animalRecordId: string;
  labAnimalId: string;
  collectedAt: string;
  collectedAtSort: number;
  project: string;
  experiment: string;
  storage: string;
  quantity: string;
  notes: string;
  correction?: { requestId: string; appliedAt: string } | null;
};

export type WorkbookBiosamplesSheet = {
  kind: "biosamples";
  rows: WorkbookBiosampleRow[];
};

export type WorkbookCryostorageRow = {
  id: string;
  sampleLabel: string;
  material: string;
  status: string;
  strain: string;
  storedAt: string;
  storedAtSort: number;
  project: string;
  storage: string;
  quantity: string;
  notes: string;
};

export type WorkbookCryostorageSheet = {
  kind: "cryostorage";
  rows: WorkbookCryostorageRow[];
};

export type WorkbookSheet =
  | WorkbookOverviewSheet
  | WorkbookRoomsSheet
  | WorkbookBreedingSheet
  | WorkbookExperimentsSheet
  | WorkbookBiosamplesSheet
  | WorkbookCryostorageSheet;

type SearchParams = Record<string, string | string[] | undefined>;

const DEFAULT_SORT: Record<WorkbookSection, string> = {
  overview: "priority",
  rooms: "location",
  breeding: "startDate",
  experiments: "experiment",
  biosamples: "collectedAt",
  cryostorage: "storedAt",
};

export const WORKBOOK_SORT_KEYS: Record<WorkbookSection, readonly string[]> = {
  overview: ["priority"],
  rooms: ["location", "cage", "lab", "occupancy", "status"],
  breeding: ["startDate", "setup", "line", "status", "progeny"],
  experiments: ["experiment", "group", "status", "assignments"],
  biosamples: ["collectedAt", "label", "animal", "status", "storage"],
  cryostorage: ["storedAt", "label", "strain", "status", "storage"],
};

const TERMINAL_SAMPLE_STATUSES = ["consumed", "discarded"] as const;
const TERMINAL_CRYO_STATUSES = ["recovered", "depleted", "discarded"] as const;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseWorkbookState(searchParams?: SearchParams): WorkbookState {
  const requestedSection = first(searchParams?.section);
  const section = WORKBOOK_SECTIONS.includes(requestedSection as WorkbookSection)
    ? (requestedSection as WorkbookSection)
    : "overview";
  const direction = first(searchParams?.direction) === "desc" ? "desc" : "asc";

  const requestedSort = first(searchParams?.sort)?.trim();

  return {
    section,
    sheet: first(searchParams?.sheet)?.trim() || "all",
    search: first(searchParams?.search)?.trim() || "",
    sort: requestedSort && WORKBOOK_SORT_KEYS[section].includes(requestedSort) ? requestedSort : DEFAULT_SORT[section],
    direction,
    history: ["1", "true", "on"].includes(first(searchParams?.history) ?? ""),
    labId: first(searchParams?.labId)?.trim() || undefined,
  };
}

export function canonicalizeWorkbookState(state: WorkbookState, navigation: WorkbookNavigation): WorkbookState {
  return {
    ...state,
    sheet: navigation.childSheets.some((sheet) => sheet.id === state.sheet) ? state.sheet : "all",
    labId: navigation.canFilterLabs && navigation.labs.some((lab) => lab.id === state.labId) ? state.labId : undefined,
  };
}

export function workbookRawStateNeedsRedirect(searchParams: SearchParams | undefined, state: WorkbookState) {
  if (searchParams && Object.values(searchParams).some(Array.isArray)) return true;

  const rawSection = first(searchParams?.section);
  const rawSheet = first(searchParams?.sheet);
  const rawSearch = first(searchParams?.search);
  const rawSort = first(searchParams?.sort);
  const rawDirection = first(searchParams?.direction);
  const rawHistory = first(searchParams?.history);
  const rawLabId = first(searchParams?.labId);

  return (
    (rawSection !== undefined && rawSection !== state.section)
    || (rawSheet !== undefined && (state.sheet === "all" || rawSheet !== state.sheet))
    || (rawSearch !== undefined && rawSearch !== state.search)
    || (rawSearch !== undefined && state.search === "")
    || (rawSort !== undefined && rawSort !== state.sort)
    || (rawDirection !== undefined && rawDirection !== (state.direction === "desc" ? "desc" : undefined))
    || (rawHistory !== undefined && rawHistory !== (state.history ? "1" : undefined))
    || (rawLabId !== undefined && rawLabId !== state.labId)
  );
}

function referenceDate() {
  return process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString();
}

function textMatches(search: string, values: Array<string | number | null | undefined>) {
  if (!search) return true;
  const needle = search.toLocaleLowerCase();
  return values.some((value) => value !== null && value !== undefined && String(value).toLocaleLowerCase().includes(needle));
}

export function sortWorkbookRows<T>(
  rows: T[],
  selector: (row: T) => string | number,
  direction: WorkbookDirection,
) {
  const multiplier = direction === "desc" ? -1 : 1;
  return [...rows].sort((left, right) => {
    const leftValue = selector(left);
    const rightValue = selector(right);
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return (leftValue - rightValue) * multiplier;
    }
    return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true }) * multiplier;
  });
}

export function classifyBreedingLine(
  adults: Array<{ role: string; animal: { strain: { id: string; name: string } } }>,
) {
  const parents = adults.filter((adult) => adult.role === "sire" || adult.role === "dam");
  const strainIds = new Set(parents.map((adult) => adult.animal.strain.id));
  if (strainIds.size === 1 && parents[0]) {
    return { id: parents[0].animal.strain.id, label: parents[0].animal.strain.name };
  }
  return { id: "cross-line", label: "Cross-line" };
}

async function getScope(actor: LabActor, requestedLabId?: string) {
  return getActorLabScope(actor, requestedLabId);
}

export async function getWorkbookNavigation(actor: WorkbookActor, state: WorkbookState): Promise<WorkbookNavigation> {
  const scope = await getScope(actor, state.labId);
  let childSheets: WorkbookChildSheet[] = [{ id: "all", label: "All" }];

  if (state.section === "rooms") {
    const cages = (await getCageListView(actor)).filter((cage) => (
      (!scope.labIds || (!!cage.labId && scope.labIds.includes(cage.labId)))
      && (state.history || (cage.active && cage.status !== "closed"))
    ));
    const rooms = [...cages.reduce((map, cage) => {
      const entry = map.get(cage.roomId) ?? { id: cage.roomId, roomNumber: cage.roomNumber, count: 0 };
      entry.count += 1;
      map.set(cage.roomId, entry);
      return map;
    }, new Map<string, { id: string; roomNumber: string; count: number }>()).values()]
      .sort((left, right) => left.roomNumber.localeCompare(right.roomNumber, undefined, { numeric: true }));
    childSheets = [
      { id: "all", label: "All rooms" },
      ...rooms.map((room) => ({ id: room.id, label: `Room ${room.roomNumber}`, count: room.count })),
      { id: "unassigned", label: "Unassigned mice" },
    ];
  } else if (state.section === "breeding") {
    const setups = (await getBreedingOverviewView(actor)).filter((setup) => (
      (!scope.labIds || scope.labIds.includes(setup.labId))
      && (state.history || ["planned", "active", "paused"].includes(setup.status))
    ));
    const strains = [...new Map(setups.flatMap((setup) => {
      const line = classifyBreedingLine(
        setup.adults.flatMap((adult) => adult.animal ? [{ role: adult.role, animal: adult.animal }] : []),
      );
      return line.id === "cross-line" ? [] : [[line.id, line.label] as const];
    })).entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
    childSheets = [
      { id: "all", label: "All lines" },
      ...strains.map((strain) => ({ id: strain.id, label: strain.name })),
      { id: "cross-line", label: "Cross-line" },
    ];
  } else if (state.section === "experiments" && canReadExperiments(actor)) {
    const experiments = (await getExperimentOverviewView(actor)).filter((experiment) => (
      (!scope.labIds || scope.labIds.includes(experiment.labId))
      && (state.history || ["planned", "active"].includes(experiment.status))
    ));
    childSheets = [
      { id: "all", label: "All active" },
      ...experiments.map((experiment) => ({ id: experiment.id, label: experiment.experimentCode })),
    ];
  } else if (state.section === "biosamples" && canReadBiosamples(actor)) {
    const samples = (await getSampleInventoryView(actor)).filter((sample) => !scope.labIds || scope.labIds.includes(sample.labId));
    const experiments = [...new Map(samples.flatMap((sample) => (
      sample.experimentId && sample.experimentCode ? [[sample.experimentId, sample.experimentCode] as const] : []
    ))).entries()]
      .map(([id, experimentCode]) => ({ id, experimentCode }))
      .sort((left, right) => left.experimentCode.localeCompare(right.experimentCode));
    childSheets = [
      { id: "all", label: "All" },
      { id: "stored", label: "Stored" },
      { id: "allocated", label: "Allocated" },
      { id: "closed", label: "Closed" },
      ...experiments.map((experiment) => ({
        id: `experiment:${experiment.id}`,
        label: experiment.experimentCode,
      })),
    ];
  } else if (state.section === "cryostorage") {
    childSheets = [
      { id: "all", label: "All" },
      { id: "stored", label: "Stored" },
      { id: "reserved", label: "Reserved" },
      { id: "closed", label: "Closed" },
    ];
  }

  return {
    allowedSections: WORKBOOK_SECTIONS.filter((section) =>
      section === "experiments"
        ? canReadExperiments(actor)
        : section === "biosamples"
          ? canReadBiosamples(actor)
          : true,
    ),
    childSheets,
    canFilterLabs: scope.access.canViewAll,
    labs: scope.labs.map((lab) => ({ id: lab.id, label: `${lab.code} · ${lab.name}` })),
  };
}

async function getOverviewSheet(actor: WorkbookActor, state: WorkbookState): Promise<WorkbookOverviewSheet> {
  const scope = await getScope(actor, state.labId);
  const includeExperiments = canReadExperiments(actor);
  const [allAnimals, allCages, allBreedings, allExperiments, allAlerts, weaningDueDays] = await Promise.all([
    getAnimalListView(actor),
    getCageListView(actor),
    getBreedingOverviewView(actor),
    includeExperiments ? getExperimentOverviewView(actor) : Promise.resolve([]),
    getDashboardAlertsView(actor),
    getWeaningDueDays(),
  ]);
  const inSelectedLab = (labId: string | null | undefined) => !scope.labIds || (!!labId && scope.labIds.includes(labId));
  const animals = allAnimals.filter((animal) => inSelectedLab(animal.owningLabId));
  const cages = allCages.filter((cage) => inSelectedLab(cage.labId) && cage.active && cage.status !== "closed");
  const breedings = allBreedings.filter((breeding) => inSelectedLab(breeding.labId) && ["planned", "active", "paused"].includes(breeding.status));
  const experiments = allExperiments.filter((experiment) => inSelectedLab(experiment.labId) && ["planned", "active"].includes(experiment.status));
  const dashboardAlerts = allAlerts.filter((alert) => inSelectedLab(alert.labId));

  const today = new Date(referenceDate());
  const dueWeaning = breedings.flatMap((breeding) => breeding.litters
    .filter((litter) => litter.litterSizeWean === null)
    .map((litter) => ({
      id: litter.id,
      setupId: breeding.id,
      birthDate: formatDate(new Date(litter.birthDate)),
      ageDays: differenceInDays(today, new Date(litter.birthDate)),
      litterSize: litter.litterSizeBirth,
      href: `/cages/intake?mode=wean&litterId=${encodeURIComponent(litter.id)}`,
      correction: litter.correction,
    })))
    .filter((litter) => litter.ageDays >= weaningDueDays);
  const capacityAlerts = cages
    .filter((cage) => cage.occupantCount > cage.capacity)
    .map((cage) => ({
      id: `capacity-${cage.id}`,
      severity: "critical" as const,
      message: `${cage.barcode} is above capacity (${cage.occupantCount} / ${cage.capacity}).`,
      context: "Capacity",
      href: `/cages/${cage.id}`,
    }));
  const alerts = [
    ...capacityAlerts,
    ...dashboardAlerts.map((alert) => ({
      id: alert.id,
      severity: alert.severity,
      message: alert.message,
      context: alert.entityType === "animal" ? "Animal follow-up" : alert.entityType === "cage" ? "Cage follow-up" : "Colony follow-up",
      href: alert.entityType === "animal" ? `/animals/${alert.entityId}` : alert.entityType === "cage" ? `/cages/${alert.entityId}` : "/notifications",
    })),
  ]
    .filter((alert) => textMatches(state.search, [alert.message, alert.context]))
    .slice(0, 10);

  return {
    kind: "overview",
    metrics: [
      { label: "Active mice", value: animals.length, href: "/animals" },
      { label: "Active cages", value: cages.length, href: "/cages" },
      { label: "Breeding setups", value: breedings.length, href: "/breeding" },
      ...(includeExperiments ? [{ label: "Active experiments", value: experiments.length, href: "/experiments" }] : []),
    ],
    alerts,
    dueWeaning,
    activeWork: [
      ...breedings.map((breeding) => ({
        id: breeding.id,
        type: "Breeding" as const,
        title: breeding.id,
        status: breeding.status,
        detail: `${breeding.targetGenotype} · since ${formatDate(new Date(breeding.startDate))}`,
        href: "/breeding",
      })),
      ...experiments.map((experiment) => ({
        id: experiment.id,
        type: "Experiment" as const,
        title: experiment.experimentCode,
        status: experiment.status,
        detail: `${experiment.title} · ${experiment.assignments.length} assignments`,
        href: "/experiments",
      })),
    ].filter((row) => textMatches(state.search, [row.title, row.detail, row.status])),
  };
}

async function getRoomsSheet(actor: LabActor, state: WorkbookState): Promise<WorkbookRoomsSheet> {
  const scope = await getScope(actor, state.labId);

  if (state.sheet === "unassigned") {
    const animals = await getAnimalListView(actor, { includeTerminal: state.history });
    const rows = animals
      .filter((animal) => animal.cageLabel === "Unassigned" && (!scope.labIds || (animal.owningLabId && scope.labIds.includes(animal.owningLabId))))
      .map((animal) => mapAnimalListRow(animal))
      .filter((animal) => textMatches(state.search, [animal.animalId, animal.labAnimalId, animal.strain, animal.genotype]));
    return {
      kind: "rooms",
      groups: [{
        id: "unassigned",
        barcode: "Unassigned mice",
        location: "No active cage",
        roomId: null,
        room: "—",
        rack: "—",
        cageNumber: "—",
        lab: "Accessible labs",
        status: "review",
        occupancy: String(rows.length),
        strain: [...new Set(rows.map((animal) => animal.strain))].join(", ") || "—",
        sexMix: sexSummary(rows.map((animal) => animal.sex)),
        warnings: rows.length ? ["Assignment needed"] : [],
        charge: "Not charged",
        animals: rows,
      }],
    };
  }

  const cages = (await getCageListView(actor, { includeTerminalAnimals: state.history })).filter((cage) => {
    if (scope.labIds && (!cage.labId || !scope.labIds.includes(cage.labId))) return false;
    if (!state.history && (!cage.active || cage.status === "closed")) return false;
    return state.sheet === "all" || cage.roomId === state.sheet;
  });

  let groups = cages.map((cage) => {
    const animals = cage.animals.map((animal) => ({
      id: animal.id,
      animalId: animal.animalId,
      labAnimalId: animal.labAnimalId,
      sex: animal.sex,
      dob: formatDate(new Date(animal.dob)),
      age: formatAgeLabel(differenceInDays(new Date(referenceDate()), new Date(animal.dob))),
      strain: animal.strain,
      genotype: animal.genotype,
      project: animal.projectCodes.join(", ") || "—",
      health: animal.healthStatus || "No concern recorded",
      status: animal.status,
    }));
    return {
      id: cage.id,
      barcode: cage.barcode,
      location: `${cage.roomNumber} / ${cage.rackNumber} / ${cage.cageNumber}`,
      roomId: cage.roomId,
      room: cage.roomNumber,
      rack: cage.rackNumber,
      cageNumber: cage.cageNumber,
      lab: cage.labCode && cage.labName ? `${cage.labCode} · ${cage.labName}` : "Unassigned lab",
      status: cage.status,
      occupancy: `${cage.occupantCount} / ${cage.capacity}`,
      strain: cage.strainSummary,
      sexMix: cage.sexComposition,
      warnings: cage.warningMessages,
      charge: cage.chargeCategoryName && cage.dailyRateCents !== null && cage.dailyRateCents !== undefined
        ? `${cage.chargeCategoryName} · ${(cage.dailyRateCents / 100).toLocaleString(undefined, { style: "currency", currency: cage.currencyCode ?? "USD" })}/day`
        : "Not charging",
      animals,
    } satisfies WorkbookRoomGroup;
  });
  groups = groups.filter((group) =>
    textMatches(state.search, [
      group.barcode,
      group.location,
      group.lab,
      group.status,
      group.strain,
      ...group.warnings,
      ...group.animals.flatMap((animal) => [animal.animalId, animal.labAnimalId, animal.genotype]),
    ]),
  );
  const selectors: Record<string, (row: WorkbookRoomGroup) => string | number> = {
    location: (row) => row.location,
    cage: (row) => row.barcode,
    lab: (row) => row.lab,
    occupancy: (row) => Number(row.occupancy.split("/")[0]),
    status: (row) => row.status,
  };
  groups = sortWorkbookRows(groups, selectors[state.sort] ?? selectors.location, state.direction);
  return { kind: "rooms", groups };
}

function mapAnimalListRow(animal: Awaited<ReturnType<typeof getAnimalListView>>[number]): WorkbookAnimalRow {
  return {
    id: animal.id,
    animalId: animal.animalId,
    labAnimalId: animal.labId,
    sex: animal.sex,
    dob: formatDate(new Date(animal.dob)),
    age: animal.ageLabel,
    strain: animal.strain,
    genotype: animal.genotypeSummary,
    project: animal.projectCodes.join(", ") || "—",
    health: animal.healthStatus || "No concern recorded",
    status: animal.status,
  };
}

function sexSummary(sexes: string[]) {
  const counts = new Map<string, number>();
  for (const sex of sexes) counts.set(sex, (counts.get(sex) ?? 0) + 1);
  return [...counts.entries()].map(([sex, count]) => `${count} ${sex}`).join(" · ") || "Empty";
}

async function getBreedingSheet(actor: LabActor, state: WorkbookState): Promise<WorkbookBreedingSheet> {
  const scope = await getScope(actor, state.labId);
  const setups = (await getBreedingOverviewView(actor)).filter((setup) => {
    if (scope.labIds && !scope.labIds.includes(setup.labId)) return false;
    return state.history || ["planned", "active", "paused"].includes(setup.status);
  });
  const dueDays = await getWeaningDueDays();
  const today = new Date(referenceDate());
  let rows = setups.map((setup) => {
    const line = classifyBreedingLine(
      setup.adults.flatMap((adult) => adult.animal ? [{ role: adult.role, animal: adult.animal }] : []),
    );
    const sire = setup.adults.find((adult) => adult.role === "sire");
    const dam = setup.adults.find((adult) => adult.role === "dam");
    const latest = setup.litters[0];
    const openLitter = setup.litters.find((litter) => litter.litterSizeWean === null);
    const openLitterAge = openLitter ? differenceInDays(today, new Date(openLitter.birthDate)) : null;
    const litters = setup.litters.map((litter) => ({
      id: litter.id,
      birthDate: formatDate(new Date(litter.birthDate)),
      age: formatAgeLabel(differenceInDays(today, new Date(litter.birthDate))),
      born: litter.litterSizeBirth,
      weaned: litter.litterSizeWean,
      progeny: litter.progeny,
      correction: litter.correction,
    }));
    return {
      id: setup.id,
      lineId: line.id,
      line: line.label,
      status: setup.status,
      sire: sire?.animal ? { id: sire.animal.id, animalId: sire.animal.animalId, genotype: sire.animal.genotype } : null,
      dam: dam?.animal ? { id: dam.animal.id, animalId: dam.animal.animalId, genotype: dam.animal.genotype } : null,
      targetGenotype: setup.targetGenotype,
      startDate: formatDate(new Date(setup.startDate)),
      startDateSort: new Date(setup.startDate).getTime(),
      age: formatAgeLabel(differenceInDays(today, new Date(setup.startDate))),
      latestLitter: latest ? `${latest.id} · ${formatDate(new Date(latest.birthDate))}` : "No litter recorded",
      weaning: !openLitter ? "Up to date" : openLitterAge! >= dueDays ? `${openLitterAge}d · due` : `${openLitterAge}d · upcoming`,
      progenyCount: setup.litters.reduce((sum, litter) => sum + litter.progeny.length, 0),
      cautions: [
        ...(!sire || !dam ? ["Parent record incomplete"] : []),
        ...(openLitterAge !== null && openLitterAge >= dueDays ? ["Weaning due"] : []),
      ],
      litters,
    } satisfies WorkbookBreedingRow;
  });
  if (state.sheet !== "all") rows = rows.filter((row) => row.lineId === state.sheet);
  rows = rows.filter((row) => textMatches(state.search, [row.id, row.line, row.status, row.sire?.animalId, row.dam?.animalId, row.targetGenotype]));
  const selectors: Record<string, (row: WorkbookBreedingRow) => string | number> = {
    startDate: (row) => row.startDateSort,
    setup: (row) => row.id,
    line: (row) => row.line,
    status: (row) => row.status,
    progeny: (row) => row.progenyCount,
  };
  return { kind: "breeding", rows: sortWorkbookRows(rows, selectors[state.sort] ?? selectors.startDate, state.direction) };
}

async function getExperimentsSheet(actor: WorkbookActor, state: WorkbookState): Promise<WorkbookExperimentsSheet> {
  if (!canReadExperiments(actor)) return { kind: "experiments", groups: [] };
  const scope = await getScope(actor, state.labId);
  const experiments = (await getExperimentOverviewView(actor)).filter((experiment) => {
    if (scope.labIds && !scope.labIds.includes(experiment.labId)) return false;
    if (!state.history && experiment.status !== "planned" && experiment.status !== "active") return false;
    return state.sheet === "all" || experiment.id === state.sheet;
  });
  let groups: WorkbookExperimentGroup[] = [];
  for (const experiment of experiments) {
    const treatmentGroups = new Map<string, WorkbookExperimentAssignment[]>();
    for (const assignment of experiment.assignments) {
      const key = assignment.treatmentGroup || "Unassigned group";
      const row = {
        id: assignment.id,
        animalId: assignment.animalId,
        animalRecordId: assignment.animalRecordId,
        sex: assignment.sex,
        strain: assignment.strain,
        genotype: assignment.genotype,
        cage: assignment.cageBarcode ?? "Unassigned",
        status: assignment.status,
        startDate: formatDate(new Date(assignment.startDate)),
        notes: assignment.notes ?? "—",
      };
      if (textMatches(state.search, [experiment.experimentCode, experiment.title, key, row.animalId, row.genotype, row.cage, row.notes])) {
        treatmentGroups.set(key, [...(treatmentGroups.get(key) ?? []), row]);
      }
    }
    for (const [treatmentGroup, assignments] of treatmentGroups) {
      groups.push({
        id: `${experiment.id}:${treatmentGroup}`,
        experimentId: experiment.id,
        experimentCode: experiment.experimentCode,
        title: experiment.title,
        project: experiment.projectCode,
        status: experiment.status,
        treatmentGroup,
        assignments,
      });
    }
    if (!experiment.assignments.length && textMatches(state.search, [experiment.experimentCode, experiment.title])) {
      groups.push({
        id: `${experiment.id}:empty`,
        experimentId: experiment.id,
        experimentCode: experiment.experimentCode,
        title: experiment.title,
        project: experiment.projectCode,
        status: experiment.status,
        treatmentGroup: "No assignments",
        assignments: [],
      });
    }
  }
  const selectors: Record<string, (row: WorkbookExperimentGroup) => string | number> = {
    experiment: (row) => row.experimentCode,
    group: (row) => row.treatmentGroup,
    status: (row) => row.status,
    assignments: (row) => row.assignments.length,
  };
  groups = sortWorkbookRows(groups, selectors[state.sort] ?? selectors.experiment, state.direction);
  return { kind: "experiments", groups };
}

async function getBiosamplesSheet(actor: LabActor, state: WorkbookState): Promise<WorkbookBiosamplesSheet> {
  if (!canReadBiosamples(actor)) {
    throw new Error("Biosample workbook access denied.");
  }
  const scope = await getScope(actor, state.labId);
  const inventory = await getSampleInventoryView(actor);
  const records = inventory.filter((record) => {
    if (scope.labIds && !scope.labIds.includes(record.labId)) return false;
    if (state.sheet === "closed") return TERMINAL_SAMPLE_STATUSES.some((status) => status === record.status);
    if (state.sheet === "stored" || state.sheet === "allocated") return record.status === state.sheet;
    if (state.sheet.startsWith("experiment:")) return record.experimentId === state.sheet.slice("experiment:".length);
    return state.history || !TERMINAL_SAMPLE_STATUSES.some((status) => status === record.status);
  });
  let rows = records.map((record) => ({
    id: record.id,
    sampleLabel: record.sampleLabel,
    type: record.sampleType,
    status: record.status,
    animalId: record.animalCode,
    animalRecordId: record.animalId,
    labAnimalId: record.animalLabCode ?? "—",
    collectedAt: formatDate(new Date(record.collectedAt)),
    collectedAtSort: new Date(record.collectedAt).getTime(),
    project: record.projectCode ?? "—",
    experiment: record.experimentCode ?? "—",
    storage: record.storageLocation ?? "—",
    quantity: record.quantityLabel ?? "—",
    notes: record.notes ?? "—",
    correction: record.correction ?? null,
  }));
  rows = rows.filter((row) => textMatches(state.search, [
    row.sampleLabel, row.type, row.status, row.animalId, row.labAnimalId, row.collectedAt,
    row.project, row.experiment, row.storage, row.quantity, row.notes, row.correction?.requestId,
  ]));
  const selectors: Record<string, (row: WorkbookBiosampleRow) => string | number> = {
    collectedAt: (row) => row.collectedAtSort,
    label: (row) => row.sampleLabel,
    animal: (row) => row.animalId,
    status: (row) => row.status,
    storage: (row) => row.storage,
  };
  return { kind: "biosamples", rows: sortWorkbookRows(rows, selectors[state.sort] ?? selectors.collectedAt, state.direction) };
}

async function getCryostorageSheet(actor: LabActor, state: WorkbookState): Promise<WorkbookCryostorageSheet> {
  const scope = await getScope(actor, state.labId);
  const inventory = await getCryostorageInventoryView(actor);
  const records = inventory.filter((record) => {
    if (scope.labIds && !scope.labIds.includes(record.labId)) return false;
    if (state.sheet === "closed") return TERMINAL_CRYO_STATUSES.some((status) => status === record.status);
    if (state.sheet === "stored" || state.sheet === "reserved") return record.status === state.sheet;
    return state.history || !TERMINAL_CRYO_STATUSES.some((status) => status === record.status);
  });
  let rows = records.map((record) => ({
    id: record.id,
    sampleLabel: record.sampleLabel,
    material: record.materialType,
    status: record.status,
    strain: record.strainName,
    storedAt: formatDate(new Date(record.storedAt)),
    storedAtSort: new Date(record.storedAt).getTime(),
    project: record.projectCode ?? "—",
    storage: record.storageLocation ?? "—",
    quantity: record.quantityLabel ?? "—",
    notes: [record.recoveryNotes, record.notes].filter(Boolean).join(" · ") || "—",
  }));
  rows = rows.filter((row) => textMatches(state.search, Object.values(row)));
  const selectors: Record<string, (row: WorkbookCryostorageRow) => string | number> = {
    storedAt: (row) => row.storedAtSort,
    label: (row) => row.sampleLabel,
    strain: (row) => row.strain,
    status: (row) => row.status,
    storage: (row) => row.storage,
  };
  return { kind: "cryostorage", rows: sortWorkbookRows(rows, selectors[state.sort] ?? selectors.storedAt, state.direction) };
}

export async function getWorkbookSheet(actor: WorkbookActor, state: WorkbookState): Promise<WorkbookSheet> {
  switch (state.section) {
    case "rooms":
      return getRoomsSheet(actor, state);
    case "breeding":
      return getBreedingSheet(actor, state);
    case "experiments":
      return getExperimentsSheet(actor, state);
    case "biosamples":
      return getBiosamplesSheet(actor, state);
    case "cryostorage":
      return getCryostorageSheet(actor, state);
    default:
      return getOverviewSheet(actor, state);
  }
}
