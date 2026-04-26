import { beforeEach, describe, expect, it } from "vitest";

import { getQuarantineSentinelView } from "@/lib/quarantine-read";
import { prisma } from "@/lib/prisma";
import { seedDatabase } from "../../prisma/seed-database";

describe("quarantine sentinel tracking", () => {
  beforeEach(async () => {
    await seedDatabase();
  }, 120_000);

  it("summarizes quarantine cages and unresolved sentinel concerns", async () => {
    const view = await getQuarantineSentinelView();
    const quarantineCage = view.cages.find((cage) => cage.id === "cage-a102-005");

    expect(view.summary.quarantineCages).toBeGreaterThan(0);
    expect(view.summary.quarantineAnimals).toBeGreaterThan(0);
    expect(view.summary.openFollowups).toBeGreaterThan(0);
    expect(view.summary.criticalConcerns).toBeGreaterThan(0);
    expect(quarantineCage?.welfareFlags).toContain("mixed-sex");
    expect(quarantineCage?.latestNote?.severity).toBe("critical");
  });

  it("marks sentinel checks due when the configured interval is shortened", async () => {
    await prisma.ruleConfig.update({
      where: { key: "sentinel_check_interval_days" },
      data: { value: 1 },
    });

    const view = await getQuarantineSentinelView();
    const quarantineCage = view.cages.find((cage) => cage.id === "cage-a102-005");

    expect(view.summary.sentinelDue).toBeGreaterThan(0);
    expect(quarantineCage?.sentinelDue).toBe(true);
  });
});
