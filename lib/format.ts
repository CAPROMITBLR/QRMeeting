import { DISPLAY_TIMEZONE } from "@/lib/config";

const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: DISPLAY_TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: DISPLAY_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

type TimeInput = string | number | Date;

function toDate(value: TimeInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDateTime(value: TimeInput): string {
  return dateTimeFormat.format(toDate(value));
}

export function formatTime(value: TimeInput): string {
  return timeFormat.format(toDate(value));
}

const clockFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: DISPLAY_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "8:30 pm" — used for auto-close labels and countdowns. */
export function formatClock(value: TimeInput): string {
  return clockFormat.format(toDate(value));
}
