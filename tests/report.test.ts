import { describe, expect, it } from "vitest";

import { formatDateTime } from "../lib/format";
import {
  buildReportCsv,
  buildReportHtml,
  buildReportText,
  type ReportAttendee,
  type ReportData,
} from "../lib/report";

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