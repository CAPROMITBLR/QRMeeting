import ExcelJS from "exceljs";

import { apiError } from "@/lib/http";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { hostKeyMatches, readHostKey } from "@/lib/host-key";
import { isUuid } from "@/lib/validation";

type AttendanceRow = {
  name: string;
  college_id: string | null;
  department: string | null;
  marked_at: Date;
  distance_m: number | null;
};

type FacultyMember = {
  facultyId: string;
  name: string;
  department?: string;
};

export async function GET(request: Request, ctx: RouteContext<"/api/meetings/[id]/export.xlsx">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return apiError(403, "forbidden", "This host link is not valid.");

  try {
    const [meeting] = await sql<{ title: string; host_token: string; starts_at: Date; closes_at: Date | null }[]>`
      select title, host_token, starts_at, closes_at
      from public.meetings
      where id = ${id}
    `;
    if (!meeting || !hostKeyMatches(readHostKey(request.url), meeting.host_token)) {
      return apiError(403, "forbidden", "This host link is not valid.");
    }

    const rows = await sql<AttendanceRow[]>`
      select name, college_id, department, marked_at, distance_m
      from public.attendance
      where meeting_id = ${id}
      order by marked_at asc
    `;
    const faculty = await loadFacultyRoster();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Meeting Attendance";
    workbook.created = new Date();

    const summary = workbook.addWorksheet("Summary");
    styleTitle(summary, `Attendance report — ${meeting.title}`, 4);
    summary.addRows([
      ["Meeting", meeting.title],
      ["Starts", formatDateTime(meeting.starts_at)],
      ["Auto-closes", meeting.closes_at ? formatDateTime(meeting.closes_at) : "Manual close"],
      ["Marked", rows.length],
      ["Faculty roster", faculty.length > 0 ? faculty.length : "Not configured"],
    ]);
    summary.getColumn(1).width = 22;
    summary.getColumn(2).width = 38;
    summary.getColumn(1).eachCell((cell, rowNumber) => {
      if (rowNumber > 1) cell.font = { bold: true, color: { argb: "8C5E26" } };
    });

    const departmentCounts = new Map<string, { present: number; absent: number; total: number }>();
    for (const row of rows) {
      const matchedFaculty = findFaculty(row, faculty);
      const department = row.department?.trim() || matchedFaculty?.department?.trim() || "Unspecified";
      const current = departmentCounts.get(department) ?? { present: 0, absent: 0, total: 0 };
      current.present += 1;
      departmentCounts.set(department, current);
    }

    const statusRows = faculty.map((member) => {
      const match = rows.some((row) => findFaculty(row, [member]) !== null);
      const department = member.department?.trim() || "Unspecified";
      const current = departmentCounts.get(department) ?? { present: 0, absent: 0, total: 0 };
      current.total += 1;
      if (!match) current.absent += 1;
      departmentCounts.set(department, current);
      return [member.facultyId, member.name, department, match ? "Present" : "Absent"];
    });

    const departmentSheet = workbook.addWorksheet("Department Summary");
    styleHeader(departmentSheet, ["Department", "Total Faculty", "Present", "Absent", "Attendance %"]);
    for (const [department, counts] of [...departmentCounts.entries()].sort()) {
      const total = counts.total || counts.present;
      departmentSheet.addRow([
        department,
        total,
        counts.present,
        counts.total ? counts.absent : "",
        total ? Math.round((counts.present / total) * 1000) / 10 : "",
      ]);
    }
    departmentSheet.getColumn(1).width = 24;
    departmentSheet.getColumn(2).width = 16;
    departmentSheet.getColumn(3).width = 12;
    departmentSheet.getColumn(4).width = 12;
    departmentSheet.getColumn(5).width = 16;

    const attendance = workbook.addWorksheet("Attendance");
    styleHeader(attendance, ["Name", "College ID", "Department", "Marked at (IST)", "Distance (m)"]);
    rows.forEach((row) =>
      attendance.addRow([
        row.name,
        row.college_id ?? "",
        row.department ?? "",
        formatDateTime(row.marked_at),
        row.distance_m === null ? "" : Math.round(row.distance_m),
      ]),
    );
    attendance.columns.forEach((column) => {
      column.width = Math.min(Math.max((column.header?.toString().length ?? 12) + 4, 14), 30);
    });

    const status = workbook.addWorksheet("Faculty Status");
    styleHeader(status, ["Faculty ID", "Name", "Department", "Status"]);
    statusRows.forEach((row) => status.addRow(row));
    status.columns.forEach((column) => {
      column.width = 22;
    });
    if (faculty.length === 0) {
      status.addRow(["", "Configure GOOGLE_SHEETS_FACULTY_URL for present/absent reconciliation.", "", ""]);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `${meeting.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "meeting"}-attendance.xlsx`;
    return new Response(buffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("xlsx export failed", error);
    return apiError(500, "server_error", "Could not generate the Excel report.");
  }
}

async function loadFacultyRoster(): Promise<FacultyMember[]> {
  const url = process.env.GOOGLE_SHEETS_FACULTY_URL?.trim();
  if (!url) return [];
  try {
    const response = await fetch(url, { next: { revalidate: 300 } });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return [];
    return body.filter(
      (member): member is FacultyMember =>
        Boolean(member) &&
        typeof member === "object" &&
        typeof (member as FacultyMember).facultyId === "string" &&
        typeof (member as FacultyMember).name === "string",
    );
  } catch {
    return [];
  }
}

function styleTitle(sheet: ExcelJS.Worksheet, title: string, mergeColumns: number) {
  sheet.mergeCells(1, 1, 1, mergeColumns);
  const cell = sheet.getCell(1, 1);
  cell.value = title;
  cell.font = { bold: true, size: 16, color: { argb: "FFFFFF" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "2A3648" } };
  cell.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 28;
}

function findFaculty(row: AttendanceRow, faculty: FacultyMember[]): FacultyMember | null {
  return (
    faculty.find(
      (member) =>
        (row.college_id && row.college_id.toLowerCase() === member.facultyId.toLowerCase()) ||
        row.name.trim().toLowerCase() === member.name.trim().toLowerCase(),
    ) ?? null
  );
}

function styleHeader(sheet: ExcelJS.Worksheet, headers: string[]) {
  const row = sheet.addRow(headers);
  row.font = { bold: true, color: { argb: "FFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "B67F3F" } };
  row.alignment = { vertical: "middle" };
  row.eachCell((cell) => {
    cell.border = { bottom: { style: "thin", color: { argb: "8C5E26" } } };
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}
