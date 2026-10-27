import { after } from "next/server";

import { sql } from "@/lib/db";
import { apiError, json } from "@/lib/http";
import { hostKeyMatches, readHostKey } from "@/lib/host-key";
import { notifyMeetingChanged } from "@/lib/realtime";
import { facultyReportDecisionSchema, firstIssueMessage } from "@/lib/schemas";
import { isUuid } from "@/lib/validation";

/** The host has dealt with a report (fixed the directory, or told them in person). */
export async function POST(request: Request, ctx: RouteContext<"/api/meetings/[id]/faculty-reports/[reportId]">) {
  const { id, reportId } = await ctx.params;
  if (!isUuid(id) || !isUuid(reportId)) return apiError(404, "not_found", "This report does not exist.");

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
    const [meeting] = await sql<{ host_token: string }[]>`
      select host_token from public.meetings where id = ${id}
    `;
    if (!meeting || !hostKeyMatches(readHostKey(request.url), meeting.host_token)) {
      return apiError(403, "forbidden", "This host link is not valid.");
    }

    const [resolved] = await sql<{ id: string }[]>`
      update public.faculty_reports
      set status = 'resolved', resolved_at = now()
      where id = ${reportId} and meeting_id = ${id} and status = 'open'
      returning id
    `;
    if (!resolved) return apiError(404, "not_found", "That report is already resolved.");

    after(() => notifyMeetingChanged(id, "report"));

    return json({ ok: true, status: "resolved" });
  } catch (error) {
    console.error("faculty report resolve failed", error);
    return apiError(500, "server_error", "Could not update this report. Please try again.");
  }
}
