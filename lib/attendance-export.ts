import ExcelJS from "exceljs";

import type { FacultyMember } from "@/lib/faculty-directory";
import { formatDateTime } from "@/lib/format";

/** One row of the attendance table, already mapped from the database. */
export type ExportAttendee = {
  name: string;
  collegeId: string | null;
  department: string | null;
  markedAt: Date;
};

export type ExportMeeting = {
  title: string;
  startsAt: Date;
  closesAt: Date | null;
};

/** Shown for a missing optional field (no MAHE ID, no department). */
const PLACEHOLDER = "—";

const TITLE_FILL = "2A3648";
const HEADER_FILL = "B67F3F";
const SUMMARY_LABEL_COLOR = "8C5E26";

const ATTENDEE_COLUMNS = ["S.No", "Full name", "MAHE ID", "Department", "Marked at (IST)"];

/**
 * Builds the whole export workbook from the same rows the host dashboard shows.
 * Pure: no database or request access, so it can be tested directly.
 */
export function buildAttendanceWorkbook({
  meeting,
  attendees,
  faculty,
}: {
  meeting: ExportMeeting;
  attendees: ExportAttendee[];
  faculty: FacultyMember[];
}): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Meeting Attendance";
  workbook.created = new Date();

  addReportSheet(workbook, meeting, attendees, faculty);
  addDepartmentSheet(workbook, attendees, faculty);
  addFacultyStatusSheet(workbook, faculty, attendees);

  return workbook;
}

function addReportSheet(
  workbook: ExcelJS.Workbook,
  meeting: ExportMeeting,
  attendees: ExportAttendee[],
  faculty: FacultyMember[],
): void {
  const sheet = workbook.addWorksheet("Attendance Report");
  styleTitle(sheet, `Attendance report — ${meeting.title}`, ATTENDEE_COLUMNS.length);

  const summary: [string, string | number][] = [
    ["Meeting", meeting.title],
    ["Starts", formatDateTime(meeting.startsAt)],
    ["Auto-closes", meeting.closesAt ? formatDateTime(meeting.closesAt) : "Manual close"],
    ["Total marked", attendees.length],
    [
      "Faculty directory",
      faculty.length > 0
        ? `${faculty.length} ${faculty.length === 1 ? "person" : "people"}`
        : "Empty — run npm run db:seed-faculty",
    ],
  ];
  for (const [label, value] of summary) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true, color: { argb: SUMMARY_LABEL_COLOR } };
  }

  sheet.addRow([]);

  const sectionRow = sheet.addRow(["Attendees"]);
  sectionRow.font = { bold: true, size: 12, color: { argb: TITLE_FILL } };

  const headerRow = styleHeader(sheet, ATTENDEE_COLUMNS);

  if (attendees.length === 0) {
    const emptyRow = sheet.addRow(["No attendees marked for this meeting."]);
    sheet.mergeCells(emptyRow.number, 1, emptyRow.number, ATTENDEE_COLUMNS.length);
    emptyRow.getCell(1).font = { italic: true, color: { argb: "6B7280" } };
  } else {
    attendees.forEach((attendee, index) => {
      sheet.addRow([
        index + 1,
        attendee.name,
        attendee.collegeId?.trim() || PLACEHOLDER,
        attendee.department?.trim() || PLACEHOLDER,
        formatDateTime(attendee.markedAt),
      ]);
    });
  }

  const widths = [8, 34, 18, 34, 24];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  // Keep the summary and the table header visible while scrolling attendees.
  sheet.views = [{ state: "frozen", ySplit: headerRow.number }];
}

function addDepartmentSheet(
  workbook: ExcelJS.Workbook,
  attendees: ExportAttendee[],
  faculty: FacultyMember[],
): void {
  const counts = new Map<string, { present: number; absent: number; total: number }>();

  for (const attendee of attendees) {
    const matched = findFaculty(attendee, faculty);
    const department = attendee.department?.trim() || matched?.department?.trim() || "Unspecified";
    const current = counts.get(department) ?? { present: 0, absent: 0, total: 0 };
    current.present += 1;
    counts.set(department, current);
  }

  for (const member of faculty) {
    const match = attendees.some((attendee) => findFaculty(attendee, [member]) !== null);
    const department = member.department.trim() || "Unspecified";
    const current = counts.get(department) ?? { present: 0, absent: 0, total: 0 };
    current.total += 1;
    if (!match) current.absent += 1;
    counts.set(department, current);
  }

  const sheet = workbook.addWorksheet("Department Summary");
  styleHeader(sheet, ["Department", "Total Faculty", "Present", "Absent", "Attendance %"]);
  for (const [department, row] of [...counts.entries()].sort()) {
    const total = row.total || row.present;
    sheet.addRow([
      department,
      total,
      row.present,
      row.total ? row.absent : "",
      total ? Math.round((row.present / total) * 1000) / 10 : "",
    ]);
  }

  const widths = [40, 16, 12, 12, 16];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function addFacultyStatusSheet(
  workbook: ExcelJS.Workbook,
  faculty: FacultyMember[],
  attendees: ExportAttendee[],
): void {
  const sheet = workbook.addWorksheet("Faculty Status");
  styleHeader(sheet, ["MAHE ID", "Name", "Department", "Status"]);
  for (const member of faculty) {
    const present = attendees.some((attendee) => findFaculty(attendee, [member]) !== null);
    sheet.addRow([
      member.maheId ?? "(no ID yet)",
      member.name,
      member.department.trim() || "Unspecified",
      present ? "Present" : "Absent",
    ]);
  }

  const widths = [18, 28, 34, 12];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  if (faculty.length === 0) {
    sheet.addRow(["", "The faculty directory is empty — load it with npm run db:seed-faculty.", "", ""]);
  }
}

function styleTitle(sheet: ExcelJS.Worksheet, title: string, mergeColumns: number): void {
  sheet.mergeCells(1, 1, 1, mergeColumns);
  const cell = sheet.getCell(1, 1);
  cell.value = title;
  cell.font = { bold: true, size: 16, color: { argb: "FFFFFF" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
  cell.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 28;
}

function styleHeader(sheet: ExcelJS.Worksheet, headers: string[]): ExcelJS.Row {
  const row = sheet.addRow(headers);
  row.font = { bold: true, color: { argb: "FFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  row.alignment = { vertical: "middle" };
  row.eachCell((cell) => {
    cell.border = { bottom: { style: "thin", color: { argb: SUMMARY_LABEL_COLOR } } };
  });
  return row;
}

/** Matches an attendance row back to a directory member, by MAHE ID or by name. */
function findFaculty(attendee: ExportAttendee, faculty: FacultyMember[]): FacultyMember | null {
  return (
    faculty.find(
      (member) =>
        (attendee.collegeId &&
          member.maheId &&
          attendee.collegeId.toLowerCase() === member.maheId.toLowerCase()) ||
        attendee.name.trim().toLowerCase() === member.name.trim().toLowerCase(),
    ) ?? null
  );
}
