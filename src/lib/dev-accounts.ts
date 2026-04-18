import type { SeedUser } from "@/lib/types";

export const seededDevUsers: SeedUser[] = [
  {
    id: "user-admin",
    name: "Maeve O'Connell",
    email: "admin@colony.local",
    password: "colony123",
    role: "admin",
    active: true,
  },
  {
    id: "user-manager",
    name: "Patrick Byrne",
    email: "manager@colony.local",
    password: "colony123",
    role: "colony_manager",
    active: true,
  },
  {
    id: "user-staff",
    name: "Aisling Murphy",
    email: "staff@colony.local",
    password: "colony123",
    role: "animal_staff",
    active: true,
  },
  {
    id: "user-researcher",
    name: "Nora Walsh",
    email: "researcher@colony.local",
    password: "colony123",
    role: "researcher",
    active: true,
  },
  {
    id: "user-readonly",
    name: "Rory Flynn",
    email: "readonly@colony.local",
    password: "colony123",
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
