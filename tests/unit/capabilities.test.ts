import { describe, expect, it } from "vitest";

import {
  actorHasCapability,
  DUTY_CAPABILITIES,
  legacyCompatibilityRole,
  normalizeUserRole,
  type ActorMembership,
} from "@/lib/capabilities";
import { getNavigationForActor, requiredCapabilityForPath } from "@/lib/navigation";

const labManager: ActorMembership = {
  labId: "lab-1",
  labName: "Lab 1",
  labCode: "LAB-1",
  role: "manager",
};

describe("role capability foundation", () => {
  it("maps transitional roles to the canonical model", () => {
    expect(normalizeUserRole("admin")).toBe("facility_admin");
    expect(normalizeUserRole("colony_manager")).toBe("cmu_staff");
    expect(normalizeUserRole("researcher")).toBe("lab_user");
  });

  it("keeps IT technical-only even if a membership is present", () => {
    const actor = { canonicalRole: "it_head" as const, activeMembership: labManager, activeDuties: ["billing_administrator" as const] };

    expect(actorHasCapability(actor, "system:view")).toBe(true);
    expect(actorHasCapability(actor, "audit:security")).toBe(true);
    expect(actorHasCapability(actor, "audit:domain")).toBe(false);
    expect(actorHasCapability(actor, "animals:read")).toBe(false);
    expect(getNavigationForActor(actor).map((item) => item.id)).toEqual(["system"]);
  });

  it("unions duty capabilities without inventing a lab membership", () => {
    const dutyOnly = {
      canonicalRole: "lab_user" as const,
      activeMembership: null,
      activeDuties: ["billing_administrator" as const, "protocol_reviewer" as const],
    };

    expect(actorHasCapability(dutyOnly, "billing:govern")).toBe(true);
    expect(actorHasCapability(dutyOnly, "protocols:approve")).toBe(true);
    expect(actorHasCapability(dutyOnly, "billing:manage")).toBe(false);
    expect(actorHasCapability(dutyOnly, "sops:approve")).toBe(false);
    expect(actorHasCapability(dutyOnly, "animals:read")).toBe(false);
    expect(getNavigationForActor(dutyOnly).map((item) => item.id)).toEqual(["dashboard"]);
  });

  it("keeps every duty mapping inside the duty-only vocabulary", () => {
    const allowed = new Set([
      "dashboard:view", "duties:read", "welfare:read", "welfare:manage", "welfare:close",
      "protocols:read", "protocols:approve", "competencies:read", "competencies:manage",
      "billing:govern", "corrections:read", "corrections:approve",
    ]);
    for (const capabilities of Object.values(DUTY_CAPABILITIES)) {
      expect(capabilities.every((capability) => allowed.has(capability))).toBe(true);
    }
  });

  it("gives CMU the operational experiment workspace but not private experiment fields", () => {
    const actor = { canonicalRole: "cmu_staff" as const, activeMembership: null };

    expect(actorHasCapability(actor, "procedures:operational")).toBe(true);
    expect(actorHasCapability(actor, "experiments:full")).toBe(false);
    expect(getNavigationForActor(actor).some((item) => item.id === "procedures")).toBe(true);
    expect(actorHasCapability(actor, "experiments:read")).toBe(true);
    expect(actorHasCapability(actor, "procedures:execute")).toBe(true);
    expect(actorHasCapability(actor, "procedures:plan")).toBe(false);
    expect(actorHasCapability(actor, "billing:generate")).toBe(true);
    expect(actorHasCapability(actor, "billing:finalize")).toBe(true);
    expect(actorHasCapability(actor, "billing:manage")).toBe(false);
    expect(getNavigationForActor(actor).some((item) => item.id === "experiments")).toBe(true);
  });

  it("derives Lab User authority only from the active membership", () => {
    const manager = { canonicalRole: "lab_user" as const, activeMembership: labManager };
    const owner = {
      canonicalRole: "lab_user" as const,
      activeMembership: { ...labManager, role: "owner" as const },
    };
    const viewer = {
      canonicalRole: "lab_user" as const,
      activeMembership: { ...labManager, role: "viewer" as const },
    };

    expect(actorHasCapability(manager, "animals:manage")).toBe(true);
    expect(actorHasCapability(manager, "transfers:request")).toBe(true);
    expect(actorHasCapability(manager, "transfers:approve")).toBe(true);
    expect(actorHasCapability(viewer, "animals:manage")).toBe(false);
    expect(actorHasCapability(viewer, "animals:read")).toBe(true);
    expect(actorHasCapability(viewer, "experiments:full")).toBe(true);
    expect(actorHasCapability(viewer, "experiments:manage")).toBe(false);
    expect(actorHasCapability(manager, "experiments:manage")).toBe(true);
    expect(actorHasCapability(manager, "procedures:plan")).toBe(true);
    expect(actorHasCapability(manager, "procedures:execute")).toBe(false);
    expect(actorHasCapability(manager, "strains:discover")).toBe(true);
    expect(actorHasCapability(manager, "strains:request")).toBe(true);
    expect(actorHasCapability(manager, "strains:manage")).toBe(true);
    expect(actorHasCapability(viewer, "strains:discover")).toBe(true);
    expect(actorHasCapability(viewer, "strains:request")).toBe(true);
    expect(actorHasCapability(viewer, "strains:manage")).toBe(false);
    expect(actorHasCapability(viewer, "procedures:plan")).toBe(false);
    expect(actorHasCapability(viewer, "procedures:operational")).toBe(true);
    expect(actorHasCapability(manager, "migrations:manage")).toBe(false);
    expect(actorHasCapability(viewer, "transfers:request")).toBe(false);
    expect(actorHasCapability(owner, "labs:manage")).toBe(true);
    expect(actorHasCapability(manager, "labs:manage")).toBe(false);
    expect(getNavigationForActor(owner).some((item) => item.id === "labs")).toBe(true);
    expect(getNavigationForActor(viewer).some((item) => item.id === "strains")).toBe(true);
  });

  it("keeps destination consent with lab principals while Facility retains finalization", () => {
    const facility = { canonicalRole: "facility_admin" as const, activeMembership: null };
    expect(actorHasCapability(facility, "transfers:approve")).toBe(false);
    expect(actorHasCapability(facility, "transfers:finalize")).toBe(true);
    expect(actorHasCapability(facility, "procedures:plan")).toBe(true);
    expect(actorHasCapability(facility, "procedures:execute")).toBe(true);
    expect(actorHasCapability(facility, "billing:generate")).toBe(true);
    expect(actorHasCapability(facility, "billing:finalize")).toBe(true);
    expect(actorHasCapability(facility, "billing:manage")).toBe(true);
    expect(actorHasCapability(facility, "strains:manage")).toBe(true);
    expect(actorHasCapability({ canonicalRole: "cmu_staff", activeMembership: null }, "strains:discover")).toBe(true);
    expect(actorHasCapability({ canonicalRole: "cmu_staff", activeMembership: null }, "strains:request")).toBe(false);
    expect(actorHasCapability({ canonicalRole: "lab_user", activeMembership: labManager }, "billing:finalize")).toBe(false);
  });

  it("reserves global migration authority for facility administrators", () => {
    expect(actorHasCapability({ canonicalRole: "facility_admin", activeMembership: null }, "migrations:manage")).toBe(true);
    expect(actorHasCapability({ canonicalRole: "cmu_staff", activeMembership: null }, "migrations:manage")).toBe(false);
    expect(actorHasCapability({ canonicalRole: "it_head", activeMembership: null }, "migrations:manage")).toBe(false);
  });

  it("separates operational audit history from IT security history", () => {
    const facility = { canonicalRole: "facility_admin" as const, activeMembership: null };
    const it = { canonicalRole: "it_head" as const, activeMembership: null };

    expect(actorHasCapability(facility, "audit:domain")).toBe(true);
    expect(actorHasCapability(facility, "audit:security")).toBe(false);
    expect(actorHasCapability(it, "audit:security")).toBe(true);
    expect(actorHasCapability(it, "audit:domain")).toBe(false);
  });

  it("provides a temporary legacy role without broadening canonical capabilities", () => {
    expect(legacyCompatibilityRole("facility_admin")).toBe("admin");
    expect(legacyCompatibilityRole("cmu_staff")).toBe("colony_manager");
    expect(legacyCompatibilityRole("lab_user", "viewer")).toBe("read_only");
    expect(legacyCompatibilityRole("it_head", "owner")).toBe("read_only");
  });

  it("maps nested routes to their page capability", () => {
    expect(requiredCapabilityForPath("/animals/animal-1")).toBe("animals:read");
    expect(requiredCapabilityForPath("/billing/invoices/invoice-1")).toBe("billing:read");
    expect(requiredCapabilityForPath("/administration/labs")).toBe("labs:manage");
    expect(requiredCapabilityForPath("/unknown")).toBeNull();
  });
});
