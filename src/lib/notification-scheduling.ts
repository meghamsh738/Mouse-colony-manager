import type { NotificationEmailMode } from "@prisma/client";

export function nextNotificationDigestAt(input: {
  now: Date;
  mode: Exclude<NotificationEmailMode, "off">;
  hourUtc: number;
  dayOfWeek: number;
}) {
  const hour = Math.max(0, Math.min(23, Math.trunc(input.hourUtc)));
  const day = Math.max(0, Math.min(6, Math.trunc(input.dayOfWeek)));
  const candidate = new Date(input.now);
  candidate.setUTCMinutes(0, 0, 0);
  candidate.setUTCHours(hour);

  if (input.mode === "daily_digest") {
    if (candidate <= input.now) candidate.setUTCDate(candidate.getUTCDate() + 1);
    return candidate;
  }

  const dayDelta = (day - candidate.getUTCDay() + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + dayDelta);
  if (candidate <= input.now) candidate.setUTCDate(candidate.getUTCDate() + 7);
  return candidate;
}
