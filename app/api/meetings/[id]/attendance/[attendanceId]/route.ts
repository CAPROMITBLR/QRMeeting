import { apiError, json } from "@/lib/http";
import { sql } from "@/lib/db";
import { hostKeyMatches, readHostKey } from "@/lib/host-key";
import { isUuid } from "@/lib/validation";

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/meetings/[id]/attendance/[attendanceId]">,
) {
  const { id, attendanceId } = await ctx.params;
  if (!isUuid(id) || !isUuid(attendanceId)) {
    return apiError(403, "forbidden", "This host link is not valid.");
  }

  try {
    const [meeting] = await sql<{ host_token: string }[]>`
      select host_token from public.meetings where id = ${id}
    `;

    if (!meeting || !hostKeyMatches(readHostKey(request.url), meeting.host_token)) {
      return apiError(403, "forbidden", "This host link is not valid.");
    }

    const [deleted] = await sql<{ id: string }[]>`
      delete from public.attendance
      where id = ${attendanceId} and meeting_id = ${id}
      returning id
    `;

    if (!deleted) return apiError(404, "not_found", "That entry no longer exists.");

    return json({ ok: true, id: deleted.id });
  } catch (error) {
    console.error("delete attendance failed", error);
    return apiError(500, "server_error", "Could not remove the entry.");
  }
}
