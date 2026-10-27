import "server-only";

import { sql } from "@/lib/db";
import type { FacultyMember } from "@/lib/faculty-directory";

type FacultyRow = { mahe_id: string | null; name: string; department: string };

function toMember(row: FacultyRow): FacultyMember {
  return { maheId: row.mahe_id, name: row.name, department: row.department };
}

/** The whole roster: 200-odd rows, one request, filtered in the browser. */
export async function loadFacultyRoster(): Promise<FacultyMember[]> {
  const rows = await sql<FacultyRow[]>`
    select mahe_id, name, department
    from public.faculty
    order by name asc
  `;
  return rows.map(toMember);
}
