const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** Converts an HTML datetime-local value interpreted as IST to a UTC Date. */
export function parseIstDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const timestamp =
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) -
    IST_OFFSET_MINUTES * 60_000;
  const result = new Date(timestamp);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function istDateTimeInput(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}T${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
}
