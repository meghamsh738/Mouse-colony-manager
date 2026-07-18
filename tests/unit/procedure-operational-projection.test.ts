import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  planFindMany: vi.fn(),
  assignmentFindMany: vi.fn(),
  sopAssignmentFindMany: vi.fn(),
  getActorLabAccess: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    procedurePlan: { findMany: mocks.planFindMany, findFirst: vi.fn() },
    experimentAssignment: { findMany: mocks.assignmentFindMany },
    sopAssignment: { findMany: mocks.sopAssignmentFindMany },
  },
}));

vi.mock("@/lib/lab-access", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/lab-access")>();
  return { ...original, getActorLabAccess: mocks.getActorLabAccess };
});

import { getProcedureWorkspace } from "@/lib/procedure-read";
import type { ResolvedActor } from "@/lib/session";

const cmu = {
  id: "cmu-1",
  email: "cmu@example.test",
  name: "CMU operator",
  role: "colony_manager",
  databaseRole: "cmu_staff",
  canonicalRole: "cmu_staff",
  authzVersion: 2,
  activeLabId: null,
  activeMembership: null,
  memberships: [],
  capabilities: ["procedures:operational", "procedures:execute"],
} as ResolvedActor;

const plan = {
  id: "plan-1",
  labId: "lab-1",
  experimentId: "experiment-1",
  assignmentId: "assignment-1",
  procedureCode: "DOSE",
  title: "Daily dose",
  scheduledAt: new Date("2026-07-20T09:00:00.000Z"),
  status: "planned",
  sopId: "sop-1",
  sopVersionId: "sop-version-2",
  sopVersionNumber: 2,
  sopContentHash: "a".repeat(64),
  sopAssignmentId: "sop-assignment-2",
  assignmentContextSnapshot: {
    animalId: "animal-1",
    startDate: "2026-07-01T00:00:00",
    endDate: null,
    treatmentGroup: "Reviewed control",
  },
  experimentContextSnapshot: {
    experimentCode: "EXP-REVIEWED",
    title: "Reviewed operational title",
    projectId: "project-1",
    projectCode: "PRJ-REVIEWED",
    plannedStartAt: "2026-07-01T00:00:00",
    plannedEndAt: "2026-07-31T00:00:00",
    operationalContact: "Reviewed contact",
  },
  createdAt: new Date("2026-07-16T09:00:00.000Z"),
  version: 1,
  lab: { code: "LAB-1", name: "Lab 1" },
  experiment: {
    experimentCode: "EXP-LIVE-CHANGED",
    title: "Live title changed after review",
    status: "active",
    plannedStartAt: new Date("2026-07-01T00:00:00.000Z"),
    plannedEndAt: new Date("2026-07-31T00:00:00.000Z"),
    operationalContact: "Live contact changed",
    project: { projectCode: "PRJ-LIVE-CHANGED" },
  },
  assignment: {
    status: "active",
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    endDate: null,
    treatmentGroup: "Live treatment changed",
    animal: {
      id: "animal-1",
      facilityAnimalId: "0001",
      sex: "female",
      strain: { name: "C57BL/6J" },
      currentCage: {
        barcode: "1000",
        cageNumber: "001",
        room: { roomNumber: "A101" },
        rack: { rackNumber: "R1" },
      },
    },
  },
  sop: { code: "SOP-1", title: "Dosing", category: "procedure" },
  createdBy: { name: "Lab manager" },
  occurrences: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActorLabAccess.mockResolvedValue({
    canViewAll: true,
    memberLabIds: [],
    manageableLabIds: [],
    membershipByLabId: new Map(),
  });
  mocks.planFindMany.mockResolvedValue([plan]);
  mocks.assignmentFindMany.mockResolvedValue([]);
  mocks.sopAssignmentFindMany.mockResolvedValue([]);
});

describe("procedure operational projection", () => {
  it("returns operational fields and exact SOP provenance without private experiment, assignment, or SOP content", async () => {
    const view = await getProcedureWorkspace(cmu);
    const row = view.rows[0];

    expect(row).toMatchObject({
      experimentCode: "EXP-REVIEWED",
      experimentTitle: "Reviewed operational title",
      projectCode: "PRJ-REVIEWED",
      operationalContact: "Reviewed contact",
      treatmentGroup: "Reviewed control",
      animalFacilityId: "0001",
      cageBarcode: "1000",
      sopVersionId: "sop-version-2",
      sopVersionNumber: 2,
      sopContentHash: "a".repeat(64),
      sopAssignmentId: "sop-assignment-2",
    });
    expect(view.assignmentOptions).toEqual([]);
    expect(view.sopOptions).toEqual([]);
    expect(view.permissions).toEqual({ canPlan: false, canExecute: true });

    const select = mocks.planFindMany.mock.calls[0][0].select;
    expect(select.experiment.select).not.toHaveProperty("notes");
    expect(select.experiment.select).not.toHaveProperty("resultSummary");
    expect(select.assignment.select).not.toHaveProperty("notes");
    expect(select.sop.select).not.toHaveProperty("contentMarkdown");
    expect(JSON.stringify(row)).not.toContain("private research");
  });
});
