import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { getNotificationInboxView } from "@/lib/notifications-read";
import { seedDatabase } from "../../prisma/seed-database";

describe("notification inbox", () => {
  beforeEach(async () => {
    await seedDatabase();
  }, 120_000);

  it("builds enabled in-app notifications from seeded alerts", async () => {
    const inbox = await getNotificationInboxView();
    const categories = new Set(inbox.notifications.map((notification) => notification.categoryKey));

    expect(inbox.preferences).toHaveLength(5);
    expect(inbox.preferences.every((preference) => preference.enabled)).toBe(true);
    expect(inbox.summary.total).toBeGreaterThan(0);
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

    const inbox = await getNotificationInboxView();
    const genotypePreference = inbox.preferences.find((preference) => preference.categoryKey === "genotype_pending");

    expect(genotypePreference?.enabled).toBe(false);
    expect(genotypePreference?.matchingAlertCount).toBeGreaterThan(0);
    expect(inbox.summary.mutedCategories).toBe(1);
    expect(inbox.notifications.some((notification) => notification.categoryKey === "genotype_pending")).toBe(false);
  });
});
