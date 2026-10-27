/**
 * Shared between the server (which serves the roster) and the attend form
 * (which filters it locally). No server-only imports: the hostname/id maths has
 * to run in the browser too.
 */

export type FacultyMember = {
  maheId: string | null;
  name: string;
  department: string;
};

/** Digits only, so a pasted "MAHE 0023571" or "mahe-23571" still lands. */
export function idDigits(value: string): string {
  return value.toUpperCase().replace(/[^0-9]/g, "");
}

/** The ID as it should be stored: "MAHE" plus the digits the person typed. */
export function formatMaheId(digits: string): string {
  const clean = idDigits(digits);
  return clean ? `MAHE${clean}` : "";
}

/**
 * Accepts what people actually type — "23571", "mahe 23571", "MAHE0023571" —
 * and returns a stored ID. Anything that is not digits keeps its own shape, so
 * a non-MAHE identifier is never mangled.
 */
export function normalizeFacultyId(value: string | null | undefined): string {
  const cleaned = (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "";
  return /^[0-9]+$/.test(cleaned) ? `MAHE${cleaned}` : cleaned;
}

/** The digits of a stored ID, ready for the "MAHE…" input. */
export function maheIdDigits(maheId: string | null): string {
  return idDigits(maheId ?? "");
}

export function sortByName(members: FacultyMember[]): FacultyMember[] {
  return [...members].sort((a, b) => a.name.localeCompare(b.name) || (a.maheId ?? "").localeCompare(b.maheId ?? ""));
}

/** Rows with no MAHE ID sort last; they simply have no ID to order by. */
export function sortById(members: FacultyMember[]): FacultyMember[] {
  return [...members].sort((a, b) => {
    if (a.maheId === null && b.maheId === null) return a.name.localeCompare(b.name);
    if (a.maheId === null) return 1;
    if (b.maheId === null) return -1;
    return a.maheId.localeCompare(b.maheId) || a.name.localeCompare(b.name);
  });
}

/** Name matching, case- and whitespace-insensitive; an empty query lists everyone. */
export function filterByName(members: FacultyMember[], query: string): FacultyMember[] {
  return filterSortedByName(sortByName(members), query);
}

/** ID matching on the digits; an empty query lists every known ID. */
export function filterById(members: FacultyMember[], query: string): FacultyMember[] {
  return filterSortedById(
    sortById(members.filter((member) => member.maheId !== null)),
    query,
  );
}

/**
 * Same matching as filterByName but skips the sort, so a caller that keeps the
 * roster pre-sorted (the attend form) does not re-sort on every keystroke.
 */
export function filterSortedByName(sorted: FacultyMember[], query: string): FacultyMember[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sorted;
  return sorted.filter((member) => member.name.toLowerCase().includes(needle));
}

/** The filterById counterpart: expects an already id-sorted list with no null IDs. */
export function filterSortedById(sorted: FacultyMember[], query: string): FacultyMember[] {
  const needle = idDigits(query);
  if (!needle) return sorted;
  return sorted.filter((member) => idDigits(member.maheId ?? "").includes(needle));
}

/** Departments for the attend form's dropdown, alphabetical and de-duplicated. */
export function departmentOptions(members: FacultyMember[]): string[] {
  return [...new Set(members.map((member) => member.department))].sort((a, b) => a.localeCompare(b));
}
