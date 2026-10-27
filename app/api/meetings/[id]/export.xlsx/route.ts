import { apiError } from "@/lib/http";
import { buildAttendanceWorkbook } from "@/lib/attendance-export";
import { sql } from "@/lib/db";
import { loadFacultyRoster } from "@/lib/faculty";
import { hostKeyMatches, readHostKey } from "@/lib/host-key";
import { isUuid } from "@/lib/validation";

type AttendanceRow = {
  name: string;
  college_id: string | null;
  department: string | null;
  marked_at: Date;
};

export async function GET(request: Request, ctx: RouteContext<"/api/meetings/[id]/export.xlsx">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return apiError(403, "forbidden", "This host link is not valid.");

  try {
    const [meeting] = await sql<{ title: string; host_token: string; starts_at: Date; closes_at: Date | null }[]>`
      select title, host_token, starts_at, closes_at
      from public.meetings
      where id = ${id}
    `;
    if (!meeting || !hostKeyMatches(readHostKey(request.url), meeting.host_token)) {
      return apiError(403, "forbidden", "This host link is not valid.");
    }

    // The same rows the host dashboard renders: the export must not summarise
    // them away.
    const rows = await sql<AttendanceRow[]>`
      select name, college_id, department, marked_at
      from public.attendance
      where meeting_id = ${id}
      order by marked_at asc
    `;
    const faculty = await loadFacultyRoster();

    const workbook = buildAttendanceWorkbook({
      meeting: {
        title: meeting.title,
        startsAt: meeting.starts_at,
        closesAt: meeting.closes_at,
      },
      attendees: rows.map((row) => ({
        name: row.name,
        collegeId: row.college_id,
        department: row.department,
        markedAt: row.marked_at,
      })),
      faculty,
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `meeting_${id.slice(-8)}.xlsx`;
    return new Response(buffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("xlsx export failed", error);
    return apiError(500, "server_error", "Could not generate the Excel report.");
  }
}
