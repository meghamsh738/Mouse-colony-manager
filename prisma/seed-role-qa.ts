import { hashPassword } from "../src/lib/password";
import { assertRoleQaSeedAllowed } from "../src/lib/destructive-seed-guard";
import { SEEDED_ROLE_QA_EMAILS } from "../src/lib/seed-metadata";
import { prisma } from "../src/lib/prisma";
import type { UserRole } from "../src/lib/types";
import { seedDatabase } from "./seed-database";
import { seedDutyQaFixture } from "./seed-duty-qa";
import { seedProtocolQaFixture } from "./seed-protocol-qa";
import { seedWelfareQaFixture } from "./seed-welfare-qa";
import { seedCorrectionQaFixture } from "./seed-correction-qa";
import { seedReconciliationQaFixture } from "./seed-reconciliation-qa";

const roleQaUsers: Array<{ id: string; name: string; email: string; role: UserRole }> = [
  { id: "user-it-head-qa", name: "QA IT Head", email: SEEDED_ROLE_QA_EMAILS.itHead, role: "it_head" },
  { id: "user-facility-admin-qa", name: "QA Facility Admin", email: SEEDED_ROLE_QA_EMAILS.facilityAdmin, role: "facility_admin" },
  { id: "user-facility-admin-approver-qa", name: "QA Facility Admin Approver", email: SEEDED_ROLE_QA_EMAILS.facilityAdminApprover, role: "facility_admin" },
  { id: "user-veterinarian-qa", name: "QA Designated Veterinarian", email: SEEDED_ROLE_QA_EMAILS.veterinarian, role: "lab_user" },
  { id: "user-cmu-staff-qa", name: "QA CMU Staff", email: SEEDED_ROLE_QA_EMAILS.cmuStaff, role: "cmu_staff" },
  { id: "user-lab-owner-qa", name: "QA Lab Owner", email: SEEDED_ROLE_QA_EMAILS.labOwner, role: "lab_user" },
  { id: "user-lab-manager-qa", name: "QA Lab Manager", email: SEEDED_ROLE_QA_EMAILS.labManager, role: "lab_user" },
  { id: "user-lab-staff-qa", name: "QA Lab Staff", email: SEEDED_ROLE_QA_EMAILS.labStaff, role: "lab_user" },
  { id: "user-lab-viewer-qa", name: "QA Lab Viewer", email: SEEDED_ROLE_QA_EMAILS.labViewer, role: "lab_user" },
];

const roleQaMemberships = [
  { id: "lab-member-qa-admin1-micro", labId: "lab-microglia", userId: "user-facility-admin-qa", role: "viewer" as const },
  { id: "lab-member-qa-admin2-micro", labId: "lab-microglia", userId: "user-facility-admin-approver-qa", role: "viewer" as const },
  { id: "lab-member-qa-owner-micro", labId: "lab-microglia", userId: "user-lab-owner-qa", role: "owner" as const },
  { id: "lab-member-qa-manager-micro", labId: "lab-microglia", userId: "user-lab-manager-qa", role: "manager" as const },
  { id: "lab-member-qa-staff-micro", labId: "lab-microglia", userId: "user-lab-staff-qa", role: "staff" as const },
  { id: "lab-member-qa-viewer-micro", labId: "lab-microglia", userId: "user-lab-viewer-qa", role: "viewer" as const },
];

export async function seedRoleQaDatabase(options: { clearAttachments?: boolean } = {}) {
  assertRoleQaSeedAllowed();
  const qaPassword = process.env.ROLE_QA_PASSWORD;
  if (!qaPassword || qaPassword.length < 12) {
    throw new Error("ROLE_QA_PASSWORD must be supplied by the operator and contain at least 12 characters.");
  }
  await seedDatabase(options);
  await prisma.user.createMany({
    data: roleQaUsers.map((user) => ({
      ...user,
      passwordHash: hashPassword(qaPassword),
      active: true,
    })),
  });
  await prisma.labMembership.createMany({ data: roleQaMemberships });
  await prisma.$transaction((tx) => seedDutyQaFixture(tx, {
    fixturePrefix: "role-qa",
    requesterId: "user-facility-admin-qa",
    approverId: "user-facility-admin-approver-qa",
    grants: [
      { targetUserId: "user-veterinarian-qa", duties: ["designated_veterinarian"] },
      { targetUserId: "user-cmu-staff-qa", duties: ["welfare_officer"] },
      { targetUserId: "user-facility-admin-qa", duties: ["protocol_reviewer", "billing_administrator"] },
      { targetUserId: "user-facility-admin-approver-qa", duties: ["training_administrator", "data_steward"] },
    ],
    syntheticIdentities: [
      { userId: "user-facility-admin-qa", subject: SEEDED_ROLE_QA_EMAILS.facilityAdmin },
      { userId: "user-facility-admin-approver-qa", subject: SEEDED_ROLE_QA_EMAILS.facilityAdminApprover },
      { userId: "user-veterinarian-qa", subject: SEEDED_ROLE_QA_EMAILS.veterinarian },
      { userId: "user-cmu-staff-qa", subject: SEEDED_ROLE_QA_EMAILS.cmuStaff },
      { userId: "user-lab-owner-qa", subject: SEEDED_ROLE_QA_EMAILS.labOwner },
      { userId: "user-lab-manager-qa", subject: SEEDED_ROLE_QA_EMAILS.labManager },
      { userId: "user-lab-staff-qa", subject: SEEDED_ROLE_QA_EMAILS.labStaff },
    ],
  }));
  await prisma.$transaction((tx) => seedProtocolQaFixture(tx));
  const previousProfile = process.env.MCM_DEPLOYMENT_PROFILE;
  process.env.MCM_DEPLOYMENT_PROFILE = "synthetic";
  try {
    await seedWelfareQaFixture();
    await seedCorrectionQaFixture();
    await seedReconciliationQaFixture();
  } finally {
    if (previousProfile === undefined) delete process.env.MCM_DEPLOYMENT_PROFILE;
    else process.env.MCM_DEPLOYMENT_PROFILE = previousProfile;
  }
}
