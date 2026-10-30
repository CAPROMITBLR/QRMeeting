import { after } from "next/server";

import { apiError, json } from "@/lib/http";
import { sql } from "@/lib/db";
import { hostKeyMatches, readHostKey } from "@/lib/host-key";
import { notifyMeetingChanged } from "@/lib/realtime";
import {
  buildReportCsv,
  buildReportHtml,
  buildReportSubject,
  buildReportText,
  sendReportEmail,
  type ReportAttendee,
  type ReportData,
  type ReportFacultyIssue,
  type ReportJoinRequest,
} from "@/lib/report";
import { isUuid, parseRecipients } from "@/lib/validation";

export const REPORT_MAX_ATTENDEES_IN_EMAIL = 500;

/**
 * Ends the meeting, then emails the attendance report (HTML summary in the
 * body, the same CSV as the export route attached) to the given recipients.
 *
 * The end is committed before the email is attempted: a failed send leaves
 * the meeting closed and `report_sent_at` unset, so the host can retry with
 * "Resend report" instead of re-closing anything.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/meetings/[id]/end">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return apiError(403, "forbidden", "This host link is not valid.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_body", "Expected a JSON body.");
  }

  const recipients = parseRecipients((body as { email?: unknown }).email);
  if (!recipients) {
    return apiError(400, "invalid_input", "Enter up to 5 valid email addresses.");
  }

  try {
    const [meeting] = await sql<{
      host_token: string;
      title: string;
      starts_at: Date;
    }[]>`
      select host_token, title, starts_at from public.meetings where id = ${id}
    `;
    if (!meeting || !hostKeyMatches(readHostKey(request.url), meeting.host_token)) {
      return apiError(403, "forbidden", "This host link is not valid.");
    }

    // 1. End the meeting right away: closing `is_open` gates new marks, and
    // `ended_at` marks the report cut-off.
    const [ended] = await sql<{ ended_at: Date; report_sent_at: Date | null }[]>`
      update public.meetings
      set is_open = false, ended_at = coalesce(ended_at, now())
      where id = ${id}
      returning ended_at, report_sent_at
    `;

    after(() => notifyMeetingChanged(id, "meeting"));

    // 2. Snapshot the report data.
    const attendeeRows = await sql<{
      name: string;
      college_id: string | null;
      department: string | null;
      marked_at: Date;
      distance_m: number | null;
      manual_approval: boolean;
    }[]>`
      select name, college_id, department, marked_at, distance_m, manual_approval
      from public.attendance
      where meeting_id = ${id}
      order by marked_at asc
    `;

    const requestRows = await sql<{
      name: string;
      college_id: string | null;
      department: string | null;
      reason: string;
      status: string;
      created_at: Date;
    }[]>`
      select name, college_id, department, reason, status, created_at
      from public.join_requests
      where meeting_id = ${id}
      order by created_at asc
    `;

    const issueRows = await sql<{
      name: string | null;
      mahe_id: string | null;
      department: string | null;
      reason: string;
      note: string | null;
      created_at: Date;
    }[]>`
      select name, mahe_id, department, reason, note, created_at
      from public.faculty_reports
      where meeting_id = ${id} and status = 'open'
      order by created_at asc
    `;

    const attendees: ReportAttendee[] = attendeeRows.map((row) => ({
      name: row.name,
      collegeId: row.college_id,
      department: row.department,
      markedAt: row.marked_at,
      distanceM: row.distance_m,
      manualApproval: row.manual_approval,
    }));

    const requests: ReportJoinRequest[] = requestRows
      .slice(0, 200)
      .map((row) => ({
        name: row.name,
        collegeId: row.college_id,
        department: row.department,
        reason: row.reason,
        status: row.status,
        createdAt: row.created_at,
      }));

    const issues: ReportFacultyIssue[] = issueRows
      .slice(0, 200)
      .map((row) => ({
        name: row.name,
        maheId: row.mahe_id,
        department: row.department,
        reason: row.reason,
        note: row.note,
        createdAt: row.created_at,
      }));

    const data: ReportData = {
      title: meeting.title,
      startsAt: meeting.starts_at,
      endedAt: ended.ended_at,
      attendees,
      requests,
      issues,
    };

    const recipientNotes =
      attendees.length > REPORT_MAX_ATTENDEES_IN_EMAIL
        ? [
            `Note: ${attendees.length} people marked; the email table lists the first ${REPORT_MAX_ATTENDEES_IN_EMAIL}. The CSV has everyone.`,
          ]
        : [];

    // 3. Send.
    const { csv, fileName } = buildReportCsv(attendees);
    const result = await sendReportEmail({
      to: recipients,
      subject: buildReportSubject(data),
      html: buildReportHtml(data),
      text: buildReportText(data, recipientNotes),
      csv,
      fileName,
    });

    if (!result.ok) {
      return json(
        {
          ok: false,
          endedAt: ended.ended_at,
          reportSentAt: ended.report_sent_at,
          recipients,
          message: result.error,
        },
        { status: 502 },
      );
    }

    const [stamped] = await sql<{ report_sent_at: Date }[]>`
      update public.meetings set report_sent_at = now()
      where id = ${id}
      returning report_sent_at
    `;

    return json({
      ok: true,
      endedAt: ended.ended_at,
      reportSentAt: stamped.report_sent_at,
      recipients,
    });
  } catch (error) {
    console.error("end meeting failed", error);
    return apiError(500, "server_error", "Could not end the meeting and send the report.");
  }
}
