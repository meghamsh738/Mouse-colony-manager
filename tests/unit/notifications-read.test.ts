import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { getNotificationInboxView } from "@/lib/notifications-read";
import { seedDatabase } from "../../prisma/seed-database";

describe("notification inbox", () => {
  const globalActor = { id: "user-admin", role: "admin" as const };
  const microgliaActor = { id: "user-staff", role: "animal_staff" as const, activeLabId: "lab-microglia" };
  const neuroimmuneActor = { id: "user-readonly", role: "read_only" as const, activeLabId: "lab-neuroimmune" };

  beforeEach(async () => {
    await seedDatabase();
  }, 120_000);

  it("builds enabled in-app notifications from seeded alerts", async () => {
    const inbox = await getNotificationInboxView(globalActor);
    const categories = new Set(inbox.notifications.map((notification) => notification.categoryKey));

    expect(inbox.preferences).toHaveLength(5);
    expect(inbox.preferences.every((preference) => preference.enabled)).toBe(true);
    expect(inbox.summary.total).toBeGreaterThan(0);
    expect(inbox.notifications.every((notification) => notification.targetLabel.length > 0)).toBe(true);
    expect(categories.has("genotype_pending")).toBe(true);
    expect(categories.has("weaning_due")).toBe(true);
    expect(categories.has("breeder_age")).toBe(true);
    expect(categories.has("welfare")).toBe(true);
    expect(categories.has("reservation_drift")).toBe(true);
  });

  it("mutes disabled categories without losing awareness of matching alerts", async () => {
    await prisma.ruleConfig.update({
      where: {
        key: "notify_in_app_genotype_pending",
      },
      data: {
        value: false,
      },
    });

    const inbox = await getNotificationInboxView(globalActor);
    const genotypePreference = inbox.preferences.find((preference) => preference.categoryKey === "genotype_pending");

    expect(genotypePreference?.enabled).toBe(false);
    expect(genotypePreference?.matchingAlertCount).toBeGreaterThan(0);
    expect(inbox.summary.mutedCategories).toBe(1);
    expect(inbox.notifications.some((notification) => notification.categoryKey === "genotype_pending")).toBe(false);
  });

  it("scopes inbox items and counts to the actor active lab", async () => {
    await prisma.alert.createMany({
      data: [
        {
          id: "test-microglia-alert",
          labId: "lab-microglia",
          entityType: "animal",
          entityId: "animal-003",
          alertType: "genotype_pending",
          severity: "warning",
          message: "Microglia-only inbox item",
          source: "manual",
          status: "open",
          generatedAt: new Date("2026-04-06T12:00:00.000Z"),
        },
        {
          id: "test-neuroimmune-alert",
          labId: "lab-neuroimmune",
          entityType: "cage",
          entityId: "cage-a102-005",
          alertType: "welfare_note",
          severity: "critical",
          message: "Neuroimmune-only inbox item",
          source: "manual",
          status: "open",
          generatedAt: new Date("2026-04-06T12:01:00.000Z"),
        },
        {
          id: "test-global-alert",
          labId: null,
          entityType: "project",
          entityId: "global-project",
          alertType: "welfare_note",
          severity: "critical",
          message: "Global-only inbox item",
          source: "manual",
          status: "open",
          generatedAt: new Date("2026-04-06T12:02:00.000Z"),
        },
      ],
    });

    const [microglia, neuroimmune, global] = await Promise.all([
      getNotificationInboxView(microgliaActor),
      getNotificationInboxView(neuroimmuneActor),
      getNotificationInboxView(globalActor),
    ]);

    expect(microglia.notifications.some((item) => item.message === "Microglia-only inbox item")).toBe(true);
    expect(microglia.notifications.some((item) => item.message === "Neuroimmune-only inbox item")).toBe(false);
    expect(microglia.notifications.some((item) => item.message === "Global-only inbox item")).toBe(false);
    expect(neuroimmune.notifications.some((item) => item.message === "Neuroimmune-only inbox item")).toBe(true);
    expect(neuroimmune.notifications.some((item) => item.message === "Microglia-only inbox item")).toBe(false);
    expect(global.notifications.some((item) => item.message === "Global-only inbox item")).toBe(true);
  });
});
