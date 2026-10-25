import { after } from "next/server";

import { apiError, json } from "@/lib/http";
import { sql } from "@/lib/db";
import { hostKeyMatches, readHostKey } from "@/lib/host-key";
import { notifyMeetingChanged } from "@/lib/realtime";
import { decisionSchema, firstIssueMessage } from "@/lib/schemas";
import { meetingWindowState } from "@/lib/time-window";
import { isUuid } from "@/lib/validation";

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

/** Host accepts or rejects a join request. Accepting marks attendance for the attendee. */
export async function POST(request: Request, ctx: RouteContext<"/api/meetings/[id]/join-requests/[requestId]">) {
  const { id, requestId } = await ctx.params;
  if (!isUuid(id) || !isUuid(requestId)) return apiError(404, "not_found", "This request does not exist.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_body", "Expected a JSON body.");
  }

  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "invalid_input", firstIssueMessage(parsed.error).message);
  const { action } = parsed.data;

  try {
    const [meeting] = await sql<{
      host_token: string;
      is_open: boolean;
      starts_at: Date;
      closes_at: Date | null;
    }[]>`
      select host_token, is_open, starts_at, closes_at
      from public.meetings
      where id = ${id}
    `;

    if (!meeting || !hostKeyMatches(readHostKey(request.url), meeting.host_token)) {
      return apiError(403, "forbidden", "This host link is not valid.");
    }
    if (meetingWindowState(new Date(), meeting.starts_at, meeting.is_open, meeting.closes_at) === "closed") {
      return apiError(409, "closed", "Attendance is closed for this meeting. Reopen it first.");
    }

    const [joinRequest] = await sql<{
      id: string;
      name: string;
      college_id: string | null;
      department: string | null;
      device_id: string;
      lat: number | null;
      lng: number | null;
      accuracy_m: number | null;
      distance_m: number | null;
      status: string;
    }[]>`
      select id, name, college_id, department, device_id, lat, lng, accuracy_m, distance_m, status
      from public.join_requests
      where id = ${requestId} and meeting_id = ${id}
    `;

    if (!joinRequest) return apiError(404, "not_found", "This join request no longer exists.");
    if (joinRequest.status !== "pending") {
      return apiError(409, "not_pending", "This request was already answered.");
    }

    if (action === "reject") {
      await sql`
        update public.join_requests
        set status = 'rejected', decided_at = now()
        where id = ${requestId}
      `;
      after(() => notifyMeetingChanged(id, "request"));
      return json({ ok: true, status: "rejected" });
    }

    let alreadyMarked = false;
    try {
      await sql`
        insert into public.attendance
          (meeting_id, name, college_id, department, device_id, lat, lng, distance_m, accuracy_m, manual_approval)
        values (
          ${id},
          ${joinRequest.name},
          ${joinRequest.college_id},
          ${joinRequest.department},
          ${joinRequest.device_id},
          ${joinRequest.lat},
          ${joinRequest.lng},
          ${joinRequest.distance_m},
          ${joinRequest.accuracy_m},
          true
        )
      `;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      alreadyMarked = true;
    }

    await sql`
      update public.join_requests
      set status = 'approved', decided_at = now()
      where id = ${requestId}
    `;
    after(() => notifyMeetingChanged(id, "request"));

    return json({
      ok: true,
      status: "approved",
      alreadyMarked,
      message: alreadyMarked
        ? "Approved. This person had already marked attendance, so no new entry was added."
        : "Approved. Attendance is marked.",
    });
  } catch (error) {
    console.error("join request decision failed", error);
    return apiError(500, "server_error", "Could not update this request. Please try again.");
  }
}
