import { after } from "next/server";

import { sql } from "@/lib/db";
import { apiError, json } from "@/lib/http";

type OpenReport = {
  id: string;
  meeting_id: string | null;
  meeting_title: string | null;
  meeting_starts_at: Date | null;
  mahe_id: string | null;
  name: string | null;
  department: string | null;
  reason: string;
  note: string | null;
  created_at: Date;
};

/** Every open report, for the shared inbox at /reports. */
export async function GET() {
  try {
    const rows = await sql<OpenReport[]>`
      select
        reports.id,
        reports.meeting_id,
        meetings.title as meeting_title,
        meetings.starts_at as meeting_starts_at,
        reports.mahe_id,
        reports.name,
        reports.department,
        reports.reason,
        reports.note,
        reports.created_at
      from public.faculty_reports as reports
      left join public.meetings as meetings on meetings.id = reports.meeting_id
      where reports.status = 'open'
      order by reports.created_at asc
      limit 500
    `;

    return json({
      reports: rows.map((row) => ({
        id: row.id,
        meetingId: row.meeting_id,
        meetingTitle: row.meeting_title,
        meetingStartsAt: row.meeting_starts_at,
        maheId: row.mahe_id,
        name: row.name,
        department: row.department,
        reason: row.reason,
        note: row.note,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("faculty report inbox failed", error);
    return apiError(500, "server_error", "Could not load the reports inbox.");
  }
}
import { facultyReportRateLimiter } from "@/lib/rate-limit";
import { notifyMeetingChanged } from "@/lib/realtime";
import { checkRateLimit, readJson } from "@/lib/request";
import { facultyReportSchema, firstIssueMessage } from "@/lib/schemas";

/**
 * "My MAHE ID is missing, or the details against it are wrong."
 * The report lands on the host page for that meeting, so the person who owns
 * the directory sees it while it still matters.
 */
export async function POST(request: Request) {
  const limited = await checkRateLimit(
    request,
    facultyReportRateLimiter,
    "Too many reports. Please wait a moment and try again.",
  );
  if (limited) return limited;

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = facultyReportSchema.safeParse(body);
  if (!parsed.success) {
    const { field, message } = firstIssueMessage(parsed.error);
    return apiError(field === "meetingId" ? 404 : 400, field === "meetingId" ? "not_found" : "invalid_input", message);
  }

  const { meetingId, maheId, name, department, reason, note, deviceId } = parsed.data;

  try {
    const [meeting] = await sql<{ id: string }[]>`
      select id from public.meetings where id = ${meetingId}
    `;
    if (!meeting) return apiError(404, "not_found", "This meeting does not exist.");

    // What the attendee wrote is stored as written: a "details are wrong"
    // report is their claim, so the directory must not overwrite it.
    await sql`
      insert into public.faculty_reports
        (meeting_id, mahe_id, name, department, reason, note, device_id)
      values (
        ${meetingId},
        ${maheId || null},
        ${name || null},
        ${department || null},
        ${reason},
        ${note || null},
        ${deviceId ?? null}
      )
    `;

    after(() => notifyMeetingChanged(meetingId, "report"));

    return json(
      {
        ok: true,
        message:
          "Report sent. The host sees it on the attendance page and in the reports inbox. You can still mark your own attendance below — type your name, ID and department.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("faculty report failed", error);
    const missingTable = (error as { code?: string } | null)?.code === "42501";
    return apiError(
      500,
      "server_error",
      missingTable
        ? "The reports table is not set up in the database yet. Ask the host to run the database migrations."
        : "Could not send your report right now. Please tell the host directly.",
    );
  }
}
