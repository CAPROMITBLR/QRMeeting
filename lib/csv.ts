const INJECTION_PREFIX = /^[=+\-@\t\r]/;

/** Quote a cell and neutralise spreadsheet formula injection. */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (INJECTION_PREFIX.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  // BOM keeps Excel happy with non-ASCII names.
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Shared report file name: `meeting_<last 8 chars of the meeting id>.<ext>`. */
export function reportFileName(meetingId: string, extension: "csv" | "xlsx"): string {
  return `meeting_${meetingId.slice(-8)}.${extension}`;
}
