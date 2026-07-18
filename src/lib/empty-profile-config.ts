import type { UserRole } from "@/lib/types";

export const EMPTY_LABS = [
  { id: "lab-default", code: "LAB-1", name: "Lab 1" },
  { id: "lab-2", code: "LAB-2", name: "Lab 2" },
] as const;

export const EMPTY_PROFILES = [
  {
    id: "user-it-head",
    name: "IT head",
    email: "it.head@colony.local",
    role: "it_head" satisfies UserRole,
    scope: "Technical console only",
  },
  {
    id: "user-admin",
    name: "Main overall",
    email: "admin@colony.local",
    role: "facility_admin" satisfies UserRole,
    scope: "Facility administration",
  },
  {
    id: "user-cmu-staff",
    name: "CMU staff",
    email: "cmu.staff@colony.local",
    role: "cmu_staff" satisfies UserRole,
    scope: "Facility-wide operations",
  },
  {
    id: "user-lab-1",
    name: "Lab user 1",
    email: "lab1.user@colony.local",
    role: "lab_user" satisfies UserRole,
    scope: "Lab 1 only",
  },
  {
    id: "user-lab-2",
    name: "Lab user 2",
    email: "lab2.user@colony.local",
    role: "lab_user" satisfies UserRole,
    scope: "Lab 2 only",
  },
] as const;

export type EmptyProfileId = (typeof EMPTY_PROFILES)[number]["id"];

const emptyProfileIds = new Set<string>(EMPTY_PROFILES.map((profile) => profile.id));

export function isEmptyProfileId(value: unknown): value is EmptyProfileId {
  return typeof value === "string" && emptyProfileIds.has(value);
}
