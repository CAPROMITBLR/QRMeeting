import "server-only";

import { Buffer } from "node:buffer";

import nodemailer from "nodemailer";

import { reportFileName, toCsv } from "@/lib/csv";
import { countLabel, formatDateTime } from "@/lib/format";

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
export function buildReportCsv(
  meetingId: string,
  attendees: ReportAttendee[],
): {
  csv: string;
  fileName: string;
} {
  const csv = toCsv([
    ["S.No", "Full name", "MAHE-ID", "Department", "Marked at (IST)"],
    ...attendees.map((person, index) => [
      index + 1,
      person.manualApproval ? `${person.name} (host-approved)` : person.name,
      person.collegeId,
      person.department,
      formatDateTime(person.markedAt),
    ]),
  ]);
  return { csv, fileName: reportFileName(meetingId, "csv") };
}

export function buildReportSubject(data: ReportData): string {
  return `Attendance report · ${formatDateTime(data.startsAt)} IST`;
}

export function buildReportText(
  data: ReportData,
  recipientNotes: string[],
  hostUrl: string,
): string {
  const lines: string[] = [];
  lines.push(`Attendance report — ${data.title}`);
  lines.push(
    `${countLabel(data.attendees.length, "attendee")} marked attendance · ${formatDateTime(
      data.startsAt,
    )} – ${formatDateTime(data.endedAt)} IST`,
  );
  lines.push("");
  lines.push("S.No · Full name · MAHE-ID · Department · Marked at (IST)");
  data.attendees.forEach((person, index) => {
    const bits = [
      index + 1,
      person.manualApproval ? `${person.name} (host-approved)` : person.name,
      person.collegeId ?? "no MAHE ID",
      person.department ?? "no department",
      formatDateTime(person.markedAt),
    ];
    lines.push(bits.join(" · "));
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
  lines.push("");
  lines.push(
    `Download the CSV or Excel report from the host page any time: ${hostUrl}`,
  );
  return lines.join("\r\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildReportHtml(data: ReportData, hostUrl: string): string {
  const attendeeRows = data.attendees
    .map(
      (person, index) => `
        <tr>
          <td style="padding:6px 10px;border-top:1px solid #e2e8f0;color:#64748b">${index + 1}</td>
          <td style="padding:6px 10px;border-top:1px solid #e2e8f0;color:#0f2545;font-weight:600">${escapeHtml(
            person.name,
          )}${person.manualApproval ? '<span style="margin-left:6px;font-size:10px;color:#92700b;background:#faf3dd;border-radius:4px;padding:1px 6px">host-approved</span>' : ""}</td>
          <td style="padding:6px 10px;border-top:1px solid #e2e8f0;color:#475569">${escapeHtml(person.collegeId ?? "—")}</td>
          <td style="padding:6px 10px;border-top:1px solid #e2e8f0;color:#475569">${escapeHtml(person.department ?? "—")}</td>
          <td style="padding:6px 10px;border-top:1px solid #e2e8f0;color:#475569;white-space:nowrap">${escapeHtml(formatDateTime(person.markedAt))}</td>
        </tr>`,
    )
    .join("");

  const sections: string[] = [];

  sections.push(
    `<p style="margin:0 0 16px;color:#334155"><strong style="color:#0f2545;font-size:15px">${escapeHtml(
      countLabel(data.attendees.length, "attendee"),
    )}</strong><span style="color:#64748b"> marked attendance · ${escapeHtml(
      formatDateTime(data.startsAt),
    )} – ${escapeHtml(formatDateTime(data.endedAt))} IST</span></p>`,
  );

  if (data.attendees.length > 0) {
    sections.push(
      `<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;margin:0 0 18px">
        <thead><tr>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">S.No</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">Full name</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">MAHE-ID</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">Department</th>
          <th align="left" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">Marked at (IST)</th>
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
      <h1 style="margin:0 0 16px;font-size:19px;color:#0f2545">${escapeHtml(data.title)}</h1>
      ${sections.join("\n      ")}
      <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">
        <a href="${escapeHtml(hostUrl)}" style="display:inline-block;background:#0f2545;color:#ffffff;text-decoration:none;font-weight:600;font-size:12px;padding:8px 14px;border-radius:6px">Open host page</a>
        <span style="margin-left:10px">Download the CSV or Excel report from there any time.</span>
      </p>
    </div>
  </body></html>`;
}

export type SendResult = { ok: true };
export type SendFailure = { ok: false; error: string };

/** App passwords are often pasted with their grouping spaces; strip them. */
function gmailCredentials(): { user: string; pass: string } | null {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!user || !pass) return null;
  return { user, pass };
}

function describeMailError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const response = (error as { response?: string } | null)?.response ?? "";
  if (code === "EAUTH" || /\b(534|535|5\.7\.8)\b/.test(response)) {
    return (
      "Gmail rejected the sign-in — check GMAIL_USER and GMAIL_APP_PASSWORD " +
      "(use a 16-character App Password, not your account password)."
    );
  }
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS"].includes(code ?? "")) {
    return "Could not reach Gmail's SMTP server. The meeting is ended — try “Resend report”.";
  }
  const message = (error as { message?: string } | null)?.message;
  return (
    message?.trim() ||
    "The email service refused the message. The meeting is ended — try “Resend report”."
  );
}

/**
 * Sends the report over Gmail SMTP with nodemailer. Returns a human-readable
 * failure instead of throwing so the route can keep the meeting ended and
 * offer a retry.
 */
export async function sendReportEmail(options: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  csv: string;
  fileName: string;
}): Promise<SendResult | SendFailure> {
  const credentials = gmailCredentials();
  if (!credentials) {
    return {
      ok: false,
      error:
        "Email is not set up yet — add GMAIL_USER and GMAIL_APP_PASSWORD to the environment.",
    };
  }

  try {
    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: credentials,
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 20_000,
    });

    await transport.sendMail({
      from: `MAHE Attendance <${credentials.user}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: [
        {
          filename: options.fileName,
          content: Buffer.from(options.csv, "utf8"),
          contentType: "text/csv; charset=utf-8",
        },
      ],
    });

    return { ok: true };
  } catch (error) {
    console.error("report email failed", error);
    return { ok: false, error: describeMailError(error) };
  }
}
