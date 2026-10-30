import "server-only";

import { Buffer } from "node:buffer";

import { csvFileName, toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/format";

export type ReportAttendee = {
  name: string;
  collegeId: string | null;
  department: string | null;
  markedAt: Date;
  distanceM: number | null;
  manualApproval: boolean;
};

export type ReportJoinRequest = {
  name: string;
  collegeId: string | null;
  department: string | null;
  reason: string;
  status: string;
  createdAt: Date;
};

export type ReportFacultyIssue = {
  name: string | null;
  maheId: string | null;
  department: string | null;
  reason: string;
  note: string | null;
  createdAt: Date;
};

export type ReportData = {
  title: string;
  startsAt: Date;
  endedAt: Date;
  attendees: ReportAttendee[];
  requests: ReportJoinRequest[];
  issues: ReportFacultyIssue[];
};

const JOIN_REASON_LABELS: Record<string, string> = {
  outside_range: "outside the geofence",
  location_required: "location not shared",
  location_inaccurate: "location too inaccurate",
};

const ISSUE_REASON_LABELS: Record<string, string> = {
  id_missing: "MAHE ID not in the directory",
  details_incorrect: "name or department is wrong",
  other: "something else",
};

/** Same columns as the CSV export route, so both stay consistent. */
export function buildReportCsv(attendees: ReportAttendee[]): {
  csv: string;
  fileName: string;
} {
  const csv = toCsv([
    ["Name", "MAHE ID", "Department", "Marked at (IST)", "Distance from venue (m)"],
    ...attendees.map((person) => [
      person.manualApproval ? `${person.name} (host-approved)` : person.name,
      person.collegeId,
      person.department,
      formatDateTime(person.markedAt),
      person.distanceM === null ? "" : Math.round(person.distanceM),
    ]),
  ]);
  return { csv, fileName: csvFileName("attendance") };
}

export function buildReportSubject(data: ReportData): string {
  return `Attendance report · ${formatDateTime(data.startsAt)} IST`;
}

export function buildReportText(data: ReportData, recipientNotes: string[]): string {
  const lines: string[] = [];
  lines.push(`Attendance report — ${data.title}`);
  lines.push(`Meeting started ${formatDateTime(data.startsAt)} IST · ended ${formatDateTime(data.endedAt)} IST`);
  lines.push(`${data.attendees.length} attendee(s) marked attendance.`);
  lines.push("");
  lines.push("Attendees (also attached as CSV):");
  data.attendees.forEach((person, index) => {
    const bits = [
      `#${index + 1}`,
      person.manualApproval ? `${person.name} (host-approved)` : person.name,
      person.collegeId ?? "no MAHE ID",
      person.department ?? "no department",
      formatDateTime(person.markedAt),
    ];
    lines.push(`  ${bits.join(" · ")}`);
  });
  if (data.requests.length > 0) {
    lines.push("");
    lines.push("Geofence join requests:");
    data.requests.forEach((item) => {
      lines.push(
        `  ${item.name}${item.collegeId ? ` (${item.collegeId})` : ""} · ${
          JOIN_REASON_LABELS[item.reason] ?? item.reason
        } · ${item.status}`,
      );
    });
  }
  if (data.issues.length > 0) {
    lines.push("");
    lines.push("Directory issues reported by attendees:");
    data.issues.forEach((item) => {
      lines.push(
        `  ${item.name ?? "name not given"} · ${ISSUE_REASON_LABELS[item.reason] ?? item.reason}${
          item.note ? ` — "${item.note}"` : ""
        }`,
      );
    });
  }
  if (recipientNotes.length > 0) {
    lines.push("");
    lines.push(...recipientNotes);
  }
  return lines.join("\r\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildReportHtml(data: ReportData): string {
  const attendeeRows = data.attendees
    .map(
      (person, index) => `
        <tr>
          <td style="padding:6px 10px;border-top:1px solid #e2e8f0;color:#64748b">${index + 1}</td>
          <td style="padding:6px 10px;border-top:1px solid #e2e8f0;color:#0f2545;font-weight:600">${
            escapeHtml(person.name)
          }${person.manualApproval ? '<span style="margin-left:6px;font-size:10px;color:#92700b;background:#faf3dd;border-radius:4px;padding:1px 6px">host-approved</span>' : ""}</td>
          <td style="padding:6px 10px;border-top:1px solid #e2e8f0;color:#475569">${escapeHtml(person.collegeId ?? "—")}</td>
          <td style="padding:6px 10px;border-top:1px solid #e2e8f0;color:#475569">${escapeHtml(person.department ?? "—")}</td>
          <td style="padding:6px 10px;border-top:1px solid #e2e8f0;color:#475569;white-space:nowrap">${escapeHtml(formatDateTime(person.markedAt))}</td>
        </tr>`,
    )
    .join("");

  const sections: string[] = [];

  sections.push(
    `<p style="margin:0 0 12px;color:#334155">The attendance sheet for <strong>${escapeHtml(
      data.title,
    )}</strong> (${escapeHtml(formatDateTime(data.startsAt))} IST) is attached as a CSV file. Meeting ended ${escapeHtml(
      formatDateTime(data.endedAt),
    )} IST.</p>`,
  );

  sections.push(
    `<p style="margin:0 0 16px"><strong style="color:#0f2545;font-size:15px">${data.attendees.length}</strong><span style="color:#64748b"></span> attendee(s) marked attendance.</p>`,
  );

  if (data.attendees.length > 0) {
    sections.push(
      `<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;margin:0 0 18px">
        <thead><tr>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">#</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">Name</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">MAHE ID</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">Department</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">Marked at</th>
        </tr></thead>
        <tbody>${attendeeRows}</tbody>
      </table>`,
    );
  }

  if (data.requests.length > 0 || data.issues.length > 0) {
    const extras: string[] = [];
    if (data.requests.length > 0) {
      extras.push(
        `<p style="margin:0 0 4px"><strong style="color:#92700b">Geofence join requests:</strong> ${data.requests
          .map(
            (item) =>
              `${escapeHtml(item.name)}${
                item.collegeId ? ` (${escapeHtml(item.collegeId)})` : ""
              } — ${escapeHtml(
                JOIN_REASON_LABELS[item.reason] ?? item.reason,
              )} · ${escapeHtml(item.status)}</li>`,
          )
          .join(" · ")}</p>`,
      );
    }
    if (data.issues.length > 0) {
      extras.push(
        `<p style="margin:0"><strong style="color:#92700b">Directory issues:</strong> ${data.issues
          .map(
            (item) =>
              `${escapeHtml(item.name ?? "name not given")} — ${escapeHtml(
                ISSUE_REASON_LABELS[item.reason] ?? item.reason,
              )}${item.note ? ` (“${escapeHtml(item.note)}”)` : ""}`,
          )
          .join(" · ")}</p>`,
      );
    }
    sections.push(
      `<div style="border-left:3px solid #c19a33;padding:2px 0 2px 10px;margin:0 0 4px">${extras.join("")}</div>`,
    );
  }

  return `<!doctype html><html><body style="margin:0;background:#f6f4f0;padding:24px">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
      <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#c19a33;font-weight:700;margin:0 0 6px">MAHE Meeting Attendance</div>
      <h1 style="margin:0 0 16px;font-size:19px;color:#0f2545">Attendance report</h1>
      ${sections.join("\n      ")}
      <p style="margin:16px 0 0;font-size:11px;color:#94a3b8">Records are also exportable any time from the meeting's host page (CSV or Excel).</p>
    </div>
  </body></html>`;
}

export type SendResult = { ok: true };

/**
 * Sends the report through Resend (https://resend.com). Returns a
 * human-readable failure instead of throwing so the route can keep the
 * meeting ended and offer a retry.
 *
 * `RESEND_FROM` sets the sender ("Name <addr>"); without it the test sender
 * is used, which Resend only allows to deliver to the account owner's own
 * address until a domain is verified.
 */
export async function sendReportEmail(options: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  csv: string;
  fileName: string;
}): Promise<SendResult | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "Email is not set up yet — add RESEND_API_KEY to the environment." };
  }

  const from = process.env.RESEND_FROM?.trim() || "MAHE Attendance <onboarding@resend.dev>";

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        attachments: [
          { filename: options.fileName, content: Buffer.from(options.csv, "utf8").toString("base64") },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    console.error("report email request failed", error);
    return { ok: false, error: "Could not reach the email service. The meeting is ended — try “Resend report”." };
  }

  if (response.ok) return { ok: true };

  let detail: string | null = null;
  try {
    const body = (await response.json()) as {
      message?: string;
      description?: string;
      details?: Record<string, string[]> | string;
    };
    detail = body.message ?? body.description ?? null;
    if (!detail && body.details) {
      detail = typeof body.details === "string" ? body.details : Object.values(body.details).flat().join(" ");
    }
  } catch {
    detail = null;
  }
  if (!detail) {
    detail =
      response.status === 401
        ? "The email API key was rejected — check RESEND_API_KEY."
        : `The email service refused the message (HTTP ${response.status}).`;
  }
  if (/domain|verified|onboarding|test-email|not authorized/i.test(detail)) {
    detail =
      `${detail} Tip: with no verified domain, the test sender can only deliver to your own email address. ` +
      `Verify your domain in Resend and set RESEND_FROM (e.g. "MAHE Attendance <no-reply@yourdomain>") to send to anyone.`;
  }
  console.error("report email rejected", response.status, detail);
  return { ok: false, error: detail };
}
