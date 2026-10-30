export { isUuid } from "@/lib/identifiers";
export { normalizeText } from "@/lib/text";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Comma- or whitespace-separated recipients, like the input on the host page.
 * Bounded so one sloppy paste cannot turn into a bulk send.
 */
export function parseRecipients(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const list = value
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  if (list.length === 0 || list.length > 5) return null;
  if (list.some((part) => part.length > 254 || !EMAIL_PATTERN.test(part))) return null;
  return list;
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
