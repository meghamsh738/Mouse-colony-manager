import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EMPTY_PROFILES } from "@/lib/empty-profile-config";
import { getNavigationForActor } from "@/lib/navigation";
import { roleQaSeedTargetErrors } from "@/lib/destructive-seed-guard";

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, "prisma/migrations/0037_facility_duty_identity_assurance/migration.sql"), "utf8");
const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const authSource = fs.readFileSync(path.join(root, "src/auth.ts"), "utf8");
const seedEmpty = fs.readFileSync(path.join(root, "prisma/seed-empty.ts"), "utf8");
const seedRoleQa = fs.readFileSync(path.join(root, "prisma/seed-role-qa.ts"), "utf8");
const dutySeed = fs.readFileSync(path.join(root, "prisma/seed-duty-qa.ts"), "utf8");
const dutyPage = fs.readFileSync(path.join(root, "src/app/administration/duties/page.tsx"), "utf8");
const approvalsPage = fs.readFileSync(path.join(root, "src/app/approvals/page.tsx"), "utf8");

describe("M12 facility duty and identity assurance contract", () => {
  it("adds all six duties and Restrict-bound governance ledgers", () => {
    for (const duty of [
      "designated_veterinarian",
      "welfare_officer",
      "protocol_reviewer",
      "training_administrator",
      "billing_administrator",
      "data_steward",
    ]) {
      expect(schema).toContain(duty);
      expect(migration).toContain(`'${duty}'`);
    }
    expect(schema).toContain("model FacilityDutyRequest");
    expect(schema).toContain("model FacilityDutyAssignment");
    expect(schema).toContain("model ExternalIdentityLink");
    expect(schema).toContain("onDelete: Restrict");
  });

  it("enforces validity, 24-hour expiry, independence, serialized overlap, and version bindings", () => {
    expect(migration).toContain("INTERVAL '1 minute'");
    expect(migration).toContain("INTERVAL '366 days'");
    expect(migration).toContain("INTERVAL '24 hours'");
    expect(migration).toContain('"decidedById" <> "requestedById"');
    expect(migration).toContain('"decidedById" <> "targetUserId"');
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("tstzrange");
    expect(migration).toContain('assignment_record.version <> OLD."assignmentVersion"');
    expect(migration).toContain("target authorization snapshot changed");
    expect(migration).toContain("mcm_identity_assurance_snapshot_is_current");
    expect(migration).toContain('authenticated_at >= evidence_at - INTERVAL \'10 minutes\'');
    expect(migration).toContain('SET "authzVersion" = "authzVersion" + 1');
    expect(migration).not.toContain('"requestedById" <> "targetUserId"');
  });

  it("protects lifecycle history against update, delete, and truncate", () => {
    expect(migration).toContain('"FacilityDutyLifecycleEvent_append_only"');
    expect(migration).toContain('"ExternalIdentityLifecycleEvent_append_only"');
    expect(migration).toContain('"FacilityDutyRequest_delete_guard"');
    expect(migration).toContain('"FacilityDutyAssignment_truncate_guard"');
    expect(migration).toContain("mcm.allow_destructive_seed");
    expect(migration).toContain("append-only lifecycle history");
  });

  it("keeps duties out of JWTs while carrying assurance evidence", () => {
    expect(authSource).toContain("token.authMethod");
    expect(authSource).toContain("token.assurance");
    expect(authSource).toContain("token.authenticatedAt");
    expect(authSource).toContain("token.identityLinkId");
    expect(authSource).not.toMatch(/token\.(?:duties|activeDuties)/);
  });

  it("persists immutable requester and decider assurance evidence with Restrict identity links", () => {
    for (const field of [
      "requestedAssurance",
      "requestedIdentityLinkId",
      "requestedAuthenticatedAt",
      "decidedAssurance",
      "decidedIdentityLinkId",
      "decidedAuthenticatedAt",
    ]) {
      expect(schema).toContain(field);
      expect(migration).toContain(`"${field}"`);
    }
    expect(schema).toContain('@relation("FacilityDutyRequesterAssurance"');
    expect(schema).toContain('@relation("FacilityDutyDeciderAssurance"');
    expect(migration).toContain("identity_link.\"userId\" = subject_user_id");
    expect(migration).toContain("identity_link.assurance = asserted_assurance");
  });

  it("seeds independent admins, a veterinarian, six approved grants, and synthetic identity evidence", () => {
    expect(EMPTY_PROFILES.map((profile) => profile.id)).toEqual(expect.arrayContaining(["user-admin-2", "user-veterinarian"]));
    expect(seedEmpty).toContain("seedDutyQaFixture");
    expect(seedRoleQa).toContain("user-facility-admin-approver-qa");
    expect(seedRoleQa).toContain("user-veterinarian-qa");
    expect(seedRoleQa).toContain("ROLE_QA_PASSWORD");
    expect(seedRoleQa).not.toContain("SEEDED_DEV_PASSWORD");
    expect(dutySeed).toContain("for (const [index, grant] of grants.entries())");
    expect(dutySeed).toContain('status: "approved"');
    expect(dutySeed).toContain("externalIdentityLifecycleEvent.create");
    expect(seedEmpty).toContain('{ targetUserId: "user-veterinarian", duties: ["designated_veterinarian"] }');
    expect(seedEmpty).toContain('{ targetUserId: "user-cmu-staff", duties: ["welfare_officer"] }');
    expect(seedEmpty).toContain('{ targetUserId: "user-admin", duties: ["protocol_reviewer", "billing_administrator"] }');
    expect(seedEmpty).toContain('{ targetUserId: "user-admin-2", duties: ["training_administrator", "data_steward"] }');
    expect(dutySeed).toContain("tx.user.findUniqueOrThrow");
  });

  it("requires role-QA targets to be loopback mcm_test databases or schemas", () => {
    expect(roleQaSeedTargetErrors("postgresql://postgres:postgres@127.0.0.1:5432/mcm_test_duties?schema=mcm_test_duties")).toEqual([]);
    expect(roleQaSeedTargetErrors("postgresql://postgres:postgres@db.example.test:5432/mcm_test_duties?schema=mcm_test_duties")).toContain("database must use a loopback host");
    expect(roleQaSeedTargetErrors("postgresql://postgres:postgres@127.0.0.1:5432/colony_prod?schema=public")).toContain("database name or schema must start with mcm_test_");
  });

  it("integrates a responsive duties page and approvals without a public API route", () => {
    expect(getNavigationForActor({ canonicalRole: "facility_admin", activeMembership: null }).map((item) => item.id)).toContain("duties");
    expect(dutyPage).toContain('className="data-table-wrap hidden md:block"');
    expect(dutyPage).toContain('className="worksheet-mobile-list md:hidden"');
    expect(dutyPage).toContain("<MobileWorksheetCard");
    expect(dutyPage).toContain("Synthetic assurance");
    expect(dutyPage).not.toContain("filter((user) => user.id !== actor.id)");
    expect(approvalsPage).toContain("getFacilityDutyApprovalQueue");
    expect(approvalsPage).toContain("DutyDecisionForm");
    expect(fs.existsSync(path.join(root, "src/app/api/facility-duties"))).toBe(false);
    expect(fs.existsSync(path.join(root, "src/app/api/v1/facility-duties"))).toBe(false);
  });
});
