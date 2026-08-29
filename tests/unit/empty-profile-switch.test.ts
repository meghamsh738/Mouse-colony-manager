import { describe, expect, it } from "vitest";

import { EMPTY_PROFILES } from "@/lib/empty-profile-config";
import { isEmptyProfileSwitcherEnabled, isVerifiedEmptyProfileSwitch } from "@/lib/empty-profile-switch";

const instanceId = "5b27790c450802be078167c288c58d00";

function validSwitch() {
  return {
    sourceProfileId: "user-admin",
    sourceActive: true,
    destinationProfileId: "user-lab-1",
    destinationActive: true,
    destinationEmail: "lab1.user@colony.local",
    configuredInstanceId: instanceId,
    storedInstanceId: instanceId,
  };
}

describe("empty profile switching", () => {
  it("is impossible to enable in production", () => {
    expect(isEmptyProfileSwitcherEnabled("production", "true")).toBe(false);
    expect(isEmptyProfileSwitcherEnabled("development", "true")).toBe(true);
    expect(isEmptyProfileSwitcherEnabled("development", "false")).toBe(false);
  });

  it("keeps the requested profiles and scopes explicit", () => {
    expect(EMPTY_PROFILES.map(({ id, role, scope }) => ({ id, role, scope }))).toEqual([
      { id: "user-it-head", role: "it_head", scope: "Technical console only" },
      { id: "user-admin", role: "facility_admin", scope: "Facility administration" },
      { id: "user-admin-2", role: "facility_admin", scope: "Independent facility approval" },
      { id: "user-cmu-staff", role: "cmu_staff", scope: "Facility-wide operations" },
      { id: "user-lab-1", role: "lab_user", scope: "Lab 1 only" },
      { id: "user-lab-2", role: "lab_user", scope: "Lab 2 only" },
      { id: "user-veterinarian", role: "lab_user", scope: "Time-bounded facility duties only" },
    ]);
  });

  it("accepts an active allowlisted switch with a matching instance marker", () => {
    expect(isVerifiedEmptyProfileSwitch(validSwitch())).toBe(true);
  });

  it.each([
    ["unknown source", { sourceProfileId: "user-unknown" }],
    ["inactive source", { sourceActive: false }],
    ["unknown destination", { destinationProfileId: "user-unknown" }],
    ["inactive destination", { destinationActive: false }],
    ["wrong destination email", { destinationEmail: "other@colony.local" }],
    ["missing configured marker", { configuredInstanceId: undefined }],
    ["short configured marker", { configuredInstanceId: "too-short", storedInstanceId: "too-short" }],
    ["mismatched database marker", { storedInstanceId: "another-instance-marker-value" }],
  ])("rejects %s", (_label, override) => {
    expect(isVerifiedEmptyProfileSwitch({ ...validSwitch(), ...override })).toBe(false);
  });
});
