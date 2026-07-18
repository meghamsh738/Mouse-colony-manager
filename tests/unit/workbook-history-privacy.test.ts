import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActorLabScope: vi.fn(),
  getAnimalListView: vi.fn(),
  getCageListView: vi.fn(),
  getBreedingOverviewView: vi.fn(),
  getWeaningDueDays: vi.fn(),
  getExperimentOverviewView: vi.fn(),
  getSampleInventoryView: vi.fn(),
  getCryostorageInventoryView: vi.fn(),
  getDashboardAlertsView: vi.fn(),
}));

vi.mock("@/lib/lab-access", () => ({ getActorLabScope: mocks.getActorLabScope }));
vi.mock("@/lib/animals-read", () => ({ getAnimalListView: mocks.getAnimalListView }));
vi.mock("@/lib/cages-read", () => ({ getCageListView: mocks.getCageListView }));
vi.mock("@/lib/breeding-read", () => ({
  getBreedingOverviewView: mocks.getBreedingOverviewView,
  getWeaningDueDays: mocks.getWeaningDueDays,
}));
vi.mock("@/lib/experiments-read", () => ({ getExperimentOverviewView: mocks.getExperimentOverviewView }));
vi.mock("@/lib/samples-read", () => ({ getSampleInventoryView: mocks.getSampleInventoryView }));
vi.mock("@/lib/cryostorage-read", () => ({ getCryostorageInventoryView: mocks.getCryostorageInventoryView }));
vi.mock("@/lib/dashboard-read", () => ({ getDashboardAlertsView: mocks.getDashboardAlertsView }));

import { getWorkbookNavigation, getWorkbookSheet, parseWorkbookState } from "@/lib/workbook-read";

const actor = { id: "lab-b-user", role: "read_only" as const, activeLabId: "lab-b" };

describe("workbook authorized repository contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActorLabScope.mockResolvedValue({
      access: { canViewAll: false, memberLabIds: ["lab-b"], manageableLabIds: [], membershipByLabId: new Map() },
      labs: [{ id: "lab-b", name: "Lab B", code: "LAB-B" }],
      selectedLabId: undefined,
      labIds: ["lab-b"],
    });
    mocks.getAnimalListView.mockResolvedValue([]);
    mocks.getCageListView.mockResolvedValue([]);
    mocks.getBreedingOverviewView.mockResolvedValue([]);
    mocks.getWeaningDueDays.mockResolvedValue(21);
    mocks.getExperimentOverviewView.mockResolvedValue([]);
    mocks.getSampleInventoryView.mockResolvedValue([]);
    mocks.getCryostorageInventoryView.mockResolvedValue([]);
    mocks.getDashboardAlertsView.mockResolvedValue([]);
  });

  it("builds overview and room sheets only from actor-aware domain projections", async () => {
    await getWorkbookSheet(actor, parseWorkbookState({ section: "overview" }));
    await getWorkbookSheet(actor, parseWorkbookState({ section: "rooms" }));

    expect(mocks.getAnimalListView).toHaveBeenCalledWith(actor);
    expect(mocks.getCageListView).toHaveBeenCalledWith(actor);
    expect(mocks.getDashboardAlertsView).toHaveBeenCalledWith(actor);
    expect(mocks.getCageListView).toHaveBeenCalledWith(actor, { includeTerminalAnimals: false });
  });

  it("derives history-aware navigation from the same authorized projections", async () => {
    mocks.getCageListView.mockResolvedValue([
      { id: "open", roomId: "room-a", roomNumber: "A", labId: "lab-b", active: true, status: "holding" },
      { id: "closed", roomId: "room-b", roomNumber: "B", labId: "lab-b", active: false, status: "closed" },
    ]);

    const current = await getWorkbookNavigation(actor, parseWorkbookState({ section: "rooms" }));
    const history = await getWorkbookNavigation(actor, parseWorkbookState({ section: "rooms", history: "1" }));

    expect(current.childSheets.map((sheet) => sheet.id)).toEqual(["all", "room-a", "unassigned"]);
    expect(history.childSheets.map((sheet) => sheet.id)).toEqual(["all", "room-a", "room-b", "unassigned"]);
  });

  it("consumes fail-closed biosample and cryostorage inventories without re-querying private relations", async () => {
    await getWorkbookSheet(actor, parseWorkbookState({ section: "biosamples" }));
    await getWorkbookSheet(actor, parseWorkbookState({ section: "cryostorage" }));

    expect(mocks.getSampleInventoryView).toHaveBeenCalledWith(actor);
    expect(mocks.getCryostorageInventoryView).toHaveBeenCalledWith(actor);
  });
});
