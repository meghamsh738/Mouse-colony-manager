import type { CanonicalUserRole, LabMembershipRole, UserRole } from "@/lib/types";

export type Capability =
  | "dashboard:view"
  | "scan:use"
  | "animals:read"
  | "animals:manage"
  | "cages:read"
  | "cages:manage"
  | "quarantine:read"
  | "quarantine:manage"
  | "transfers:read"
  | "transfers:request"
  | "transfers:approve"
  | "transfers:finalize"
  | "breeding:read"
  | "breeding:manage"
  | "experiments:read"
  | "experiments:full"
  | "experiments:manage"
  | "procedures:operational"
  | "procedures:plan"
  | "procedures:execute"
  | "biosamples:read"
  | "biosamples:manage"
  | "cryostorage:read"
  | "cryostorage:request"
  | "cryostorage:manage"
  | "forecast:read"
  | "sops:read"
  | "sops:manage"
  | "sops:approve"
  | "billing:read"
  | "billing:generate"
  | "billing:finalize"
  | "billing:manage"
  | "notifications:read"
  | "notifications:deliver"
  | "approvals:read"
  | "workbook:read"
  | "users:manage"
  | "labs:manage"
  | "rules:manage"
  | "audit:domain"
  | "audit:security"
  | "migrations:manage"
  | "system:view";

export type ActorMembership = {
  labId: string;
  labName: string;
  labCode: string;
  role: LabMembershipRole;
};

export type CapabilityActor = {
  canonicalRole: CanonicalUserRole;
  activeMembership: ActorMembership | null;
};

const facilityAdminCapabilities = new Set<Capability>([
  "dashboard:view", "scan:use", "animals:read", "animals:manage", "cages:read", "cages:manage",
  "quarantine:read", "quarantine:manage", "transfers:read", "transfers:finalize",
  "breeding:read", "breeding:manage", "experiments:read", "experiments:full", "experiments:manage", "procedures:operational",
  "procedures:plan", "procedures:execute",
  "biosamples:read", "biosamples:manage", "cryostorage:read", "cryostorage:request", "cryostorage:manage",
  "forecast:read", "sops:read", "sops:manage", "sops:approve", "billing:read", "billing:generate",
  "billing:finalize", "billing:manage", "notifications:read", "approvals:read", "workbook:read", "users:manage",
  "labs:manage", "rules:manage", "audit:domain", "notifications:deliver",
  "migrations:manage",
]);

const cmuCapabilities = new Set<Capability>([
  "dashboard:view", "scan:use", "animals:read", "animals:manage", "cages:read", "cages:manage",
  "quarantine:read", "quarantine:manage", "transfers:read", "transfers:finalize", "breeding:read",
  "breeding:manage", "experiments:read", "procedures:operational", "procedures:execute", "cryostorage:read", "cryostorage:manage", "sops:read",
  "sops:manage", "billing:read", "billing:generate", "billing:finalize", "notifications:read", "approvals:read", "workbook:read",
  "notifications:deliver",
]);

const labReadCapabilities: Capability[] = [
  "dashboard:view", "scan:use", "animals:read", "cages:read", "quarantine:read", "transfers:read",
  "breeding:read", "experiments:read", "experiments:full", "procedures:operational", "biosamples:read", "cryostorage:read", "forecast:read",
  "sops:read", "billing:read", "notifications:read", "workbook:read",
];

const labStaffCapabilities: Capability[] = [
  ...labReadCapabilities, "animals:manage", "cages:manage", "quarantine:manage", "breeding:manage",
  "biosamples:manage", "cryostorage:request", "experiments:manage", "procedures:plan",
];

const labManagerCapabilities: Capability[] = [
  ...labStaffCapabilities, "transfers:request", "transfers:approve", "approvals:read", "sops:manage", "sops:approve",
];

export function normalizeUserRole(role: UserRole): CanonicalUserRole {
  switch (role) {
    case "admin":
      return "facility_admin";
    case "colony_manager":
      return "cmu_staff";
    case "animal_staff":
    case "researcher":
    case "read_only":
      return "lab_user";
    default:
      return role;
  }
}

export function legacyCompatibilityRole(
  canonicalRole: CanonicalUserRole,
  membershipRole?: LabMembershipRole,
): UserRole {
  switch (canonicalRole) {
    case "it_head":
      return "read_only";
    case "facility_admin":
      return "admin";
    case "cmu_staff":
      return "colony_manager";
    case "lab_user":
      return membershipRole === "viewer" || !membershipRole ? "read_only" : "animal_staff";
  }
}

function capabilitiesForLabRole(role: LabMembershipRole | undefined) {
  switch (role) {
    case "owner":
      return new Set<Capability>([...labManagerCapabilities, "labs:manage"]);
    case "manager":
      return new Set<Capability>(labManagerCapabilities);
    case "staff":
      return new Set<Capability>(labStaffCapabilities);
    case "viewer":
      return new Set<Capability>(labReadCapabilities);
    default:
      return new Set<Capability>();
  }
}

export function getActorCapabilities(actor: CapabilityActor) {
  switch (actor.canonicalRole) {
    case "it_head":
      return new Set<Capability>(["system:view", "audit:security"]);
    case "facility_admin":
      return facilityAdminCapabilities;
    case "cmu_staff":
      return cmuCapabilities;
    case "lab_user":
      return capabilitiesForLabRole(actor.activeMembership?.role);
  }
}

export function actorHasCapability(actor: CapabilityActor, capability: Capability) {
  return getActorCapabilities(actor).has(capability);
}

export function canonicalRoleLabel(role: CanonicalUserRole) {
  return {
    it_head: "IT Head",
    facility_admin: "Facility Admin",
    cmu_staff: "CMU Staff",
    lab_user: "Lab User",
  }[role];
}
