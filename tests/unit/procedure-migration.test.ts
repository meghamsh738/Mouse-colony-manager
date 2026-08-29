import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(process.cwd(), "prisma/migrations/0019_procedure_operations/migration.sql");

describe("procedure operations migration", () => {
  it("creates exact-version plans and append-only occurrence history atomically", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain('CREATE TABLE "ProcedurePlan"');
    expect(sql).toContain('CREATE TABLE "ProcedureOccurrence"');
    expect(sql).toContain('FOREIGN KEY ("sopVersionId", "sopId") REFERENCES "SopVersion"(id, "sopId")');
    expect(sql).toContain('CONSTRAINT "ProcedurePlan_sop_hash_check"');
    expect(sql).toContain('CONSTRAINT "ProcedureOccurrence_sop_hash_check"');
    expect(sql).toContain('"sopAssignmentId" TEXT NOT NULL');
    expect(sql).toContain('"assignmentContextSnapshot" JSONB NOT NULL');
    expect(sql).toContain('"experimentContextSnapshot" JSONB NOT NULL');
    expect(sql).toContain('ProcedurePlan_sopAssignmentId_sopId_sopVersionId_labId_fkey');
    expect(sql).toContain('ProcedureOccurrence_sopAssignmentId_sopId_sopVersionId_labId_fkey');
    expect(sql).toContain('CREATE TRIGGER "ProcedureOccurrence_append_only"');
    expect(sql).toContain('CREATE TRIGGER "ProcedureOccurrence_truncate_guard"');
    expect(sql).toContain("Procedure occurrences are immutable operational history");
  });

  it("binds every procedure write to an active actor and an in-flight versioned command receipt", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain('CREATE FUNCTION "procedure_command_context_valid"');
    expect(sql).toContain("receipt.status = 'processing'");
    expect(sql).toContain('receipt."actorAuthzVersion" = actor."authzVersion"');
    expect(sql).toContain('receipt."databasePrincipal" = SESSION_USER');
    expect(sql).toContain('receipt."expectedVersion" IS NOT DISTINCT FROM expected_version');
    expect(sql).toContain('CREATE FUNCTION "procedure_actor_can_plan"');
    expect(sql).toContain('CREATE FUNCTION "procedure_actor_can_execute"');
    expect(sql).toContain('CREATE FUNCTION "procedure_assignment_context"');
    expect(sql).toContain('CREATE FUNCTION "procedure_experiment_context"');
    expect(sql).toContain('assignment_context IS NOT DISTINCT FROM "procedure_assignment_context"(assignment_id)');
    expect(sql).toContain('experiment_context IS NOT DISTINCT FROM "procedure_experiment_context"(experiment_id)');
    expect(sql).toContain('operational_at >= version."createdAt"');
    expect(sql).toContain('operational_at >= approval."decidedAt"');
    expect(sql).toContain('operational_at >= sop_assignment."assignedAt"');
    expect(sql).toContain('CREATE TRIGGER "ProcedurePlan_write_guard"');
    expect(sql).toContain('CREATE TRIGGER "ProcedureOccurrence_insert_guard"');
  });

  it("keeps planning with the lab and execution with CMU or Facility roles", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("membership.role IN ('owner', 'manager', 'staff')");
    expect(sql).toContain("actor.role IN ('facility_admin', 'admin', 'cmu_staff', 'colony_manager')");
    expect(sql).not.toContain("actor.role IN ('facility_admin', 'admin', 'cmu_staff', 'colony_manager', 'lab_user')");
  });

  it("protects lifecycle SOP snapshots and blocks lab transfers with an open plan", async () => {
    const [sql, transferSource] = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(path.join(process.cwd(), "src/lib/lab-transfer-write.ts"), "utf8"),
    ]);

    expect(sql).toContain('CONSTRAINT "AnimalStatusEvent_sop_snapshot_check"');
    expect(sql).toContain('CREATE TRIGGER "AnimalStatusEvent_sop_snapshot_guard"');
    expect(sql).toContain('assignment."labId" = animal."owningLabId"');
    expect(sql).toContain('document."currentVersionId" = version.id');
    expect(sql).toContain('assignment."revokedAt" IS NULL');
    expect(sql).toContain('NEW."happenedAt" >= version."createdAt"');
    expect(sql).toContain('NEW."happenedAt" >= approval."decidedAt"');
    expect(sql).toContain('NEW."happenedAt" >= assignment."assignedAt"');
    expect(sql).not.toContain('NEW."happenedAt"::date');
    expect(sql).toContain('CREATE TRIGGER "AnimalStatusEvent_append_only"');
    expect(sql).toContain('CREATE TRIGGER "AnimalStatusEvent_truncate_guard"');
    expect(sql).toContain('Animal lifecycle status events are append-only history');
    expect(sql).toContain('CREATE TRIGGER "Animal_open_procedure_transfer_guard"');
    expect(sql).toContain("Open procedure plans must be cancelled before transferring the animal to another lab");
    expect(transferSource).toContain('kind: "procedure_plan"');
    expect(transferSource).toContain("Cancel each planned procedure before transferring the animal to another lab.");
  });

  it("requires an exact assigned SOP for euthanasia and retains it in event and audit history", async () => {
    const [writeSource, actionSource, formSource, readSource, apiSource, procedureReadSource] = await Promise.all([
      readFile(path.join(process.cwd(), "src/lib/colony-write.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/app/animals/[animalId]/actions.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/components/app/animal-lifecycle-form.tsx"), "utf8"),
      readFile(path.join(process.cwd(), "src/lib/animals-read.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/app/api/v1/animals/route.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/lib/procedure-read.ts"), "utf8"),
    ]);

    for (const source of [writeSource, actionSource, formSource]) expect(source).toContain("sopAssignmentId");
    expect(writeSource).toContain('input.targetStatus === "euthanized" && !sopAssignmentId');
    expect(writeSource).toContain('input.targetStatus !== "euthanized" && sopAssignmentId');
    expect(writeSource).toContain("sopContentHash: sopAssignment?.sopVersion.contentHash ?? null");
    expect(readSource).toContain("sopVersionNumber: true");
    expect(readSource).toContain("sopContentHash: true");
    expect(apiSource).toContain('value.targetStatus === "euthanized" && !value.sopAssignmentId');
    expect(apiSource).toContain('value.targetStatus !== "euthanized" && value.sopAssignmentId');
    expect(apiSource).toContain("Euthanasia requires an exact date and time with a timezone.");
    expect(apiSource).toContain("sopAssignmentId: parsed.data.sopAssignmentId");
    expect(procedureReadSource).toContain("assignmentContextSnapshot: plan.assignmentContextSnapshot");
    expect(procedureReadSource).toContain("experimentContextSnapshot: plan.experimentContextSnapshot");
  });

  it("does not invent procedure or lifecycle provenance for historical records", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).not.toMatch(/INSERT\s+INTO\s+"ProcedurePlan"/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"ProcedureOccurrence"/i);
    expect(sql).not.toMatch(/UPDATE\s+"AnimalStatusEvent"\s+SET\s+"sop/i);
  });

  it("deletes procedure and lifecycle children before restricted SOP parents during disposable reseeding", async () => {
    const source = await readFile(path.join(process.cwd(), "prisma/seed-database.ts"), "utf8");
    const sopAssignmentDelete = source.indexOf("prisma.sopAssignment.deleteMany()");
    const animalStatusDelete = source.indexOf('DELETE FROM "AnimalStatusEvent"');

    expect(source.indexOf("prisma.procedureOccurrence.deleteMany()")).toBeGreaterThan(-1);
    expect(source.indexOf("prisma.procedurePlan.deleteMany()")).toBeGreaterThan(-1);
    expect(animalStatusDelete).toBeGreaterThan(-1);
    expect(source.indexOf("prisma.procedureOccurrence.deleteMany()")).toBeLessThan(sopAssignmentDelete);
    expect(source.indexOf("prisma.procedurePlan.deleteMany()")).toBeLessThan(sopAssignmentDelete);
    expect(animalStatusDelete).toBeLessThan(sopAssignmentDelete);
  });
});
