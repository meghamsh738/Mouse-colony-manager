import { hashPassword } from "../src/lib/password";
import { SEEDED_DEV_PASSWORD, SEEDED_ROLE_QA_EMAILS } from "../src/lib/seed-metadata";
import { prisma } from "../src/lib/prisma";
import type { UserRole } from "../src/lib/types";
import { seedDatabase } from "./seed-database";

const roleQaUsers: Array<{ id: string; name: string; email: string; role: UserRole }> = [
  { id: "user-it-head-qa", name: "QA IT Head", email: SEEDED_ROLE_QA_EMAILS.itHead, role: "it_head" },
  { id: "user-facility-admin-qa", name: "QA Facility Admin", email: SEEDED_ROLE_QA_EMAILS.facilityAdmin, role: "facility_admin" },
  { id: "user-cmu-staff-qa", name: "QA CMU Staff", email: SEEDED_ROLE_QA_EMAILS.cmuStaff, role: "cmu_staff" },
  { id: "user-lab-owner-qa", name: "QA Lab Owner", email: SEEDED_ROLE_QA_EMAILS.labOwner, role: "lab_user" },
  { id: "user-lab-manager-qa", name: "QA Lab Manager", email: SEEDED_ROLE_QA_EMAILS.labManager, role: "lab_user" },
  { id: "user-lab-staff-qa", name: "QA Lab Staff", email: SEEDED_ROLE_QA_EMAILS.labStaff, role: "lab_user" },
  { id: "user-lab-viewer-qa", name: "QA Lab Viewer", email: SEEDED_ROLE_QA_EMAILS.labViewer, role: "lab_user" },
];

const roleQaMemberships = [
  { id: "lab-member-qa-owner-micro", labId: "lab-microglia", userId: "user-lab-owner-qa", role: "owner" as const },
  { id: "lab-member-qa-manager-micro", labId: "lab-microglia", userId: "user-lab-manager-qa", role: "manager" as const },
  { id: "lab-member-qa-staff-micro", labId: "lab-microglia", userId: "user-lab-staff-qa", role: "staff" as const },
  { id: "lab-member-qa-viewer-micro", labId: "lab-microglia", userId: "user-lab-viewer-qa", role: "viewer" as const },
];

export async function seedRoleQaDatabase() {
  await seedDatabase();
  await prisma.user.createMany({
    data: roleQaUsers.map((user) => ({
      ...user,
      passwordHash: hashPassword(SEEDED_DEV_PASSWORD),
      active: true,
    })),
  });
  await prisma.labMembership.createMany({ data: roleQaMemberships });
}
