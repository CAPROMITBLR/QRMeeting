import { apiError } from "@/lib/http";
import { csvFileName, toCsv } from "@/lib/csv";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { hostKeyMatches, readHostKey } from "@/lib/host-key";
import { isUuid } from "@/lib/validation";

export async function GET(request: Request, ctx: RouteContext<"/api/meetings/[id]/export.csv">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return apiError(403, "forbidden", "This host link is not valid.");

  try {
    const [meeting] = await sql<{ title: string; host_token: string }[]>`
      select title, host_token from public.meetings where id = ${id}
    `;

    if (!meeting || !hostKeyMatches(readHostKey(request.url), meeting.host_token)) {
      return apiError(403, "forbidden", "This host link is not valid.");
    }

    const rows = await sql<{
      name: string;
      college_id: string | null;
      department: string | null;
      marked_at: Date;
      distance_m: number | null;
    }[]>`
      select name, college_id, department, marked_at, distance_m
      from public.attendance
      where meeting_id = ${id}
      order by marked_at asc
    `;

    const csv = toCsv([
      ["Name", "College ID", "Department", "Marked at (IST)", "Distance from venue (m)"],
      ...rows.map((row) => [
        row.name,
        row.college_id,
        row.department,
        formatDateTime(row.marked_at),
        row.distance_m === null ? "" : Math.round(row.distance_m),
      ]),
    ]);

    const fileName = csvFileName(meeting.title);

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName.replace(/[^\x20-\x7E]/g, "")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("csv export failed", error);
    return apiError(500, "server_error", "Could not export attendance.");
  }
}
