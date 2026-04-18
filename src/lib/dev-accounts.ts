import type { SeedUser } from "@/lib/types";
import { SEEDED_DEV_EMAILS, SEEDED_DEV_PASSWORD } from "@/lib/seed-metadata";

export const seededDevUsers: SeedUser[] = [
  {
    id: "user-admin",
    name: "Maeve O'Connell",
    email: SEEDED_DEV_EMAILS.admin,
    password: SEEDED_DEV_PASSWORD,
    role: "admin",
    active: true,
  },
  {
    id: "user-manager",
    name: "Patrick Byrne",
    email: SEEDED_DEV_EMAILS.manager,
    password: SEEDED_DEV_PASSWORD,
    role: "colony_manager",
    active: true,
  },
  {
    id: "user-staff",
    name: "Aisling Murphy",
    email: SEEDED_DEV_EMAILS.staff,
    password: SEEDED_DEV_PASSWORD,
    role: "animal_staff",
    active: true,
  },
  {
    id: "user-researcher",
    name: "Nora Walsh",
    email: SEEDED_DEV_EMAILS.researcher,
    password: SEEDED_DEV_PASSWORD,
    role: "researcher",
    active: true,
  },
  {
    id: "user-readonly",
    name: "Rory Flynn",
    email: SEEDED_DEV_EMAILS.readonly,
    password: SEEDED_DEV_PASSWORD,
    role: "read_only",
    active: true,
  },
];

export function getSeededDevAccounts() {
  return seededDevUsers.map((user) => ({
    email: user.email,
    password: user.password,
    role: user.role,
    name: user.name,
  }));
}
