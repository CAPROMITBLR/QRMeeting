export { isUuid } from "@/lib/identifiers";
export { normalizeText } from "@/lib/text";

export function parseStartsAt(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Guard against absurd values that Postgres would reject anyway.
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return date;
}
