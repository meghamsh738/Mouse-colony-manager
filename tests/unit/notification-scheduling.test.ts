import { describe, expect, it } from "vitest";

import { nextNotificationDigestAt } from "@/lib/notification-scheduling";

describe("notification digest scheduling", () => {
  it("uses the next configured UTC hour for daily digests", () => {
    expect(nextNotificationDigestAt({
      now: new Date("2026-07-16T07:30:00.000Z"),
      mode: "daily_digest",
      hourUtc: 8,
      dayOfWeek: 1,
    }).toISOString()).toBe("2026-07-16T08:00:00.000Z");
    expect(nextNotificationDigestAt({
      now: new Date("2026-07-16T08:30:00.000Z"),
      mode: "daily_digest",
      hourUtc: 8,
      dayOfWeek: 1,
    }).toISOString()).toBe("2026-07-17T08:00:00.000Z");
  });

  it("uses the next configured weekday and never a past weekly slot", () => {
    expect(nextNotificationDigestAt({
      now: new Date("2026-07-16T12:00:00.000Z"),
      mode: "weekly_digest",
      hourUtc: 9,
      dayOfWeek: 1,
    }).toISOString()).toBe("2026-07-20T09:00:00.000Z");
    expect(nextNotificationDigestAt({
      now: new Date("2026-07-20T10:00:00.000Z"),
      mode: "weekly_digest",
      hourUtc: 9,
      dayOfWeek: 1,
    }).toISOString()).toBe("2026-07-27T09:00:00.000Z");
  });
});
