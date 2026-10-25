import { apiError, json } from "@/lib/http";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/validation";

/** The attendee's page polls this so it can show approval or rejection. */
export async function GET(_request: Request, ctx: RouteContext<"/api/join-requests/[requestId]">) {
  const { requestId } = await ctx.params;
  if (!isUuid(requestId)) return apiError(404, "not_found", "This request does not exist.");

  try {
    const [row] = await sql<{ status: string; marked_at: Date | null }[]>`
      select join_requests.status, attendance.marked_at
      from public.join_requests
      left join public.attendance
        on attendance.meeting_id = join_requests.meeting_id
        and attendance.device_id = join_requests.device_id
      where join_requests.id = ${requestId}
      limit 1
    `;

    if (!row) return apiError(404, "not_found", "This request does not exist.");
    return json({ status: row.status, markedAt: row.marked_at });
  } catch (error) {
    console.error("join request status failed", error);
    return apiError(500, "server_error", "Could not check your request right now.");
  }
}
