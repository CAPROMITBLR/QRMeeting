import { apiError, json } from "@/lib/http";
import { sql } from "@/lib/db";
import { hostKeyMatches, readHostKey } from "@/lib/host-key";
import { isUuid } from "@/lib/validation";

type Attendee = {
  id: string;
  name: string;
  college_id: string | null;
  department: string | null;
  marked_at: Date;
  distance_m: number | null;
};

export async function GET(request: Request, ctx: RouteContext<"/api/meetings/[id]/attendance">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return apiError(403, "forbidden", "This host link is not valid.");

  try {
    const [meeting] = await sql<{
      host_token: string;
      is_open: boolean;
      closes_at: Date | null;
      auto_closed: boolean;
    }[]>`
      select
        host_token, is_open, closes_at,
        (closes_at is not null and closes_at <= now()) as auto_closed
      from public.meetings where id = ${id}
    `;

    if (!meeting || !hostKeyMatches(readHostKey(request.url), meeting.host_token)) {
      return apiError(403, "forbidden", "This host link is not valid.");
    }

    const rows = await sql<Attendee[]>`
      select id, name, college_id, department, marked_at, distance_m
      from public.attendance
      where meeting_id = ${id}
      order by marked_at asc
    `;

    return json({
      isOpen: meeting.is_open && !meeting.auto_closed,
      autoClosed: meeting.auto_closed,
      closesAt: meeting.closes_at,
      count: rows.length,
      attendees: rows.map((row) => ({
        id: row.id,
        name: row.name,
        collegeId: row.college_id,
        department: row.department,
        markedAt: row.marked_at,
        distanceM: row.distance_m,
      })),
    });
  } catch (error) {
    console.error("attendance list failed", error);
    return apiError(500, "server_error", "Could not load attendance.");
  }
}
