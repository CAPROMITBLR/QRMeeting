import { after } from "next/server";

import { sql } from "@/lib/db";
import { apiError, json } from "@/lib/http";
import { notifyMeetingChanged } from "@/lib/realtime";
import { facultyReportDecisionSchema, firstIssueMessage } from "@/lib/schemas";
import { isUuid } from "@/lib/validation";

/**
 * Resolving from the shared reports inbox (/reports), where the report is not
 * tied to one host link. Same as the per-meeting route, without the host key —
 * see the note on /reports about who can reach it.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/faculty/reports/[reportId]">) {
  const { reportId } = await ctx.params;
  if (!isUuid(reportId)) return apiError(404, "not_found", "This report does not exist.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_body", "Expected a JSON body.");
  }

  const parsed = facultyReportDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "invalid_input", firstIssueMessage(parsed.error).message);
  }

  try {
    const [resolved] = await sql<{ meeting_id: string | null }[]>`
      update public.faculty_reports
      set status = 'resolved', resolved_at = now()
      where id = ${reportId} and status = 'open'
      returning meeting_id
    `;
    if (!resolved) return apiError(404, "not_found", "That report is already resolved.");

    if (resolved.meeting_id) {
      const meetingId = resolved.meeting_id;
      after(() => notifyMeetingChanged(meetingId, "report"));
    }

    return json({ ok: true, status: "resolved" });
  } catch (error) {
    console.error("faculty report resolve failed", error);
    return apiError(500, "server_error", "Could not update this report. Please try again.");
  }
}
