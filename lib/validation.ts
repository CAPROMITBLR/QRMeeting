import "server-only";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Trim, strip control characters and collapse inner whitespace.
 * Returns "" for anything that is not a non-empty string.
 */
export function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseStartsAt(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Guard against absurd values that Postgres would reject anyway.
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return date;
}

/** Device ids are generated client-side as UUIDs; accept any URL-safe id in range. */
export function isValidDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(value);
}
