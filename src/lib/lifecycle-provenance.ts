export type ExternalTransferProvenance = {
  destination: string;
  reference: string | null;
  happenedAt: string;
  reason: string;
};

const exactTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;

export function parseExactLifecycleTimestamp(value: string) {
  const match = exactTimestampPattern.exec(value.trim());
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", , timezone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const maxDay = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (day < 1 || day > maxDay || hour > 23 || minute > 59 || second > 59) return null;
  if (timezone !== "Z") {
    const offsetHour = Number(timezone.slice(1, 3));
    const offsetMinute = Number(timezone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

export function parseExternalTransferProvenance(value: unknown): ExternalTransferProvenance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    payload.status !== "transferred_out"
    || typeof payload.destination !== "string"
    || !payload.destination.trim()
    || typeof payload.happenedAt !== "string"
    || typeof payload.reason !== "string"
  ) {
    return null;
  }
  return {
    destination: payload.destination,
    reference: typeof payload.transferReference === "string" && payload.transferReference.trim()
      ? payload.transferReference
      : null,
    happenedAt: payload.happenedAt,
    reason: payload.reason,
  };
}
