import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatDateTime } from "../lib/format";
import {
  buildReportCsv,
  buildReportHtml,
  buildReportText,
  sendReportEmail,
  type ReportAttendee,
  type ReportData,
} from "../lib/report";

const sendMail = vi.hoisted(() => vi.fn());

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}));

const createTransport = nodemailer.createTransport as unknown as ReturnType<typeof vi.fn>;

const MEETING_ID = "0f9c1a2b-3c4d-4e5f-8a9b-0000b99674b4";

function parse(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (const char of csv.replace(/^\uFEFF/, "")) {
    if (quoted) {
      if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r") {
      continue;
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const ATTENDEES: ReportAttendee[] = [
  {
    name: "Dr. Abhijith M S",
    collegeId: "MAHE0027606",
    department: "School of Basic Sciences Humanities & Management",
    markedAt: new Date("2026-11-01T16:59:00.000Z"),
    distanceM: 12.4,
    manualApproval: false,
  },
];

describe("report csv", () => {
  it("names the file after the last characters of the meeting id", () => {
    const { fileName } = buildReportCsv(MEETING_ID, ATTENDEES);
    expect(fileName).toBe("meeting_b99674b4.csv");
  });

  it("uses the requested column layout without the distance column", () => {
    const rows = parse(buildReportCsv(MEETING_ID, ATTENDEES).csv);
    expect(rows[0]).toEqual(["S.No", "Full name", "MAHE-ID", "Department", "Marked at (IST)"]);
    expect(rows[1]).toEqual([
      "1",
      "Dr. Abhijith M S",
      "MAHE0027606",
      "School of Basic Sciences Humanities & Management",
      formatDateTime(ATTENDEES[0].markedAt),
    ]);
  });

  it("numbers every attendee row", () => {
    const rows = parse(
      buildReportCsv(MEETING_ID, [
        ATTENDEES[0],
        { ...ATTENDEES[0], name: "Dr. Second Person", collegeId: "MAHE0000002" },
      ]).csv,
    );
    expect(rows[1][0]).toBe("1");
    expect(rows[2][0]).toBe("2");
  });
});

const HOST_URL = `https://meeting.example/meetings/${MEETING_ID}?key=secret`;

function report(attendees: ReportAttendee[]): ReportData {
  return {
    title: "Faculty Coordination Meeting",
    startsAt: new Date("2026-11-01T12:30:00.000Z"),
    endedAt: new Date("2026-11-01T16:59:00.000Z"),
    attendees,
    requests: [],
    issues: [],
  };
}

describe("report email", () => {
  it("says 1 attendee, not 1 attendee(s)", () => {
    const html = buildReportHtml(report(ATTENDEES), HOST_URL);
    const text = buildReportText(report(ATTENDEES), [], HOST_URL);
    expect(html).toContain("1 attendee</strong>");
    expect(text).toContain("1 attendee marked attendance");
    expect(html).not.toContain("(s)");
    expect(text).not.toContain("(s)");
  });

  it("pluralises more than one attendee", () => {
    const attendees = [ATTENDEES[0], { ...ATTENDEES[0], name: "Dr. Second Person" }];
    expect(buildReportHtml(report(attendees), HOST_URL)).toContain("2 attendees</strong>");
    expect(buildReportText(report(attendees), [], HOST_URL)).toContain("2 attendees marked attendance");
  });

  it("puts the summary before the table and one footer link after it", () => {
    const html = buildReportHtml(report(ATTENDEES), HOST_URL);
    const summary = html.indexOf("attendee</strong>");
    const table = html.indexOf("<table");
    const footer = html.indexOf("Open host page");

    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeLessThan(table);
    expect(footer).toBeGreaterThan(table);
    expect(html).toContain(`href="${HOST_URL}"`);
    expect(html).toContain("Download the CSV or Excel report from there any time.");
  });

  it("plain-text fallback carries the count, rows and host link", () => {
    const text = buildReportText(report(ATTENDEES), [], HOST_URL);
    expect(text).toContain("S.No · Full name · MAHE-ID · Department · Marked at (IST)");
    expect(text).toContain("Dr. Abhijith M S");
    expect(text).toContain(HOST_URL);
  });
});

describe("gmail email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const email = {
    to: ["host@example.com"],
    subject: "Attendance report",
    html: "<p>hello</p>",
    text: "hello",
    csv: "a,b\r\n",
    fileName: "meeting_b99674b4.csv",
  };

  it("sends through Gmail SMTP with the CSV attached", async () => {
    vi.stubEnv("GMAIL_USER", "ayush@example.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop");
    sendMail.mockResolvedValue({ response: "250 OK" });

    await expect(sendReportEmail(email)).resolves.toEqual({ ok: true });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "gmail",
        auth: { user: "ayush@example.com", pass: "abcdefghijklmnop" },
      }),
    );
    expect(sendMail).toHaveBeenCalledTimes(1);

    const message = sendMail.mock.calls[0][0] as {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
      attachments: { filename: string; content: Buffer; contentType: string }[];
    };
    expect(message.from).toBe("MAHE Attendance <ayush@example.com>");
    expect(message.to).toEqual(email.to);
    expect(message.subject).toBe(email.subject);
    expect(message.html).toBe(email.html);
    expect(message.text).toBe(email.text);
    expect(message.attachments[0].filename).toBe(email.fileName);
    expect(message.attachments[0].contentType).toBe("text/csv; charset=utf-8");
    expect(Buffer.from(message.attachments[0].content).toString("utf8")).toBe(email.csv);
  });

  it("reports missing Gmail credentials without sending", async () => {
    vi.stubEnv("GMAIL_USER", "");
    vi.stubEnv("GMAIL_APP_PASSWORD", "");

    const result = await sendReportEmail(email);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.error).toContain("GMAIL_USER and GMAIL_APP_PASSWORD");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("explains a Gmail sign-in rejection", async () => {
    vi.stubEnv("GMAIL_USER", "ayush@example.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "wrong-password");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    sendMail.mockRejectedValue(
      Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"), {
        code: "EAUTH",
      }),
    );

    const result = await sendReportEmail(email);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.error).toContain("App Password");
  });
});