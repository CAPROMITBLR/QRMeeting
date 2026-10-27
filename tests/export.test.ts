import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildAttendanceWorkbook, type ExportAttendee } from "../lib/attendance-export";
import { formatDateTime } from "../lib/format";

const MEETING = {
  title: "Faculty Coordination Meeting",
  startsAt: new Date("2026-01-02T04:30:00.000Z"),
  closesAt: new Date("2026-01-02T10:30:00.000Z"),
};

const ATTENDEES: ExportAttendee[] = [
  {
    name: "Dr. Akshatha Y",
    collegeId: "MAHE0028678",
    department: "School of Computer Science Engineering",
    markedAt: new Date("2026-01-02T04:35:10.000Z"),
  },
  {
    name: "Dr. Iven Jose",
    collegeId: "MAHE0017820",
    department: "Director MIT - BLR",
    markedAt: new Date("2026-01-02T04:41:00.000Z"),
  },
  {
    name: "New Joiner Without Id",
    collegeId: null,
    department: null,
    markedAt: new Date("2026-01-02T04:50:00.000Z"),
  },
];

function matrix(sheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    const cells: string[] = [];
    for (let index = 1; index < values.length; index++) {
      const value = values[index];
      cells.push(value === null || value === undefined ? "" : String(value));
    }
    rows.push(cells);
  });
  return rows;
}

/** Serialise then reopen, so the assertions run against the file Excel would read. */
async function reopen(workbook: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buffer = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  return reopened;
}

function headerIndex(rows: string[][]): number {
  return rows.findIndex((row) => row[0] === "S.No" && row[1] === "Full name");
}

describe("attendance workbook export", () => {
  it("keeps the meeting summary above an attendee table", async () => {
    const workbook = await reopen(
      buildAttendanceWorkbook({ meeting: MEETING, attendees: ATTENDEES, faculty: [] }),
    );

    const sheet = workbook.getWorksheet("Attendance Report");
    expect(sheet).toBeTruthy();
    const rows = matrix(sheet!);

    expect(rows[0][0]).toContain("Attendance report");
    expect(rows[0][0]).toContain(MEETING.title);
    expect(rows).toContainEqual(["Meeting", MEETING.title]);
    expect(rows).toContainEqual(["Starts", formatDateTime(MEETING.startsAt)]);
    expect(rows).toContainEqual(["Auto-closes", formatDateTime(MEETING.closesAt)]);
    expect(rows).toContainEqual(["Total marked", String(ATTENDEES.length)]);
  });

  it("writes every attendee as its own numbered row with the real values", async () => {
    const workbook = await reopen(
      buildAttendanceWorkbook({ meeting: MEETING, attendees: ATTENDEES, faculty: [] }),
    );
    const rows = matrix(workbook.getWorksheet("Attendance Report")!);

    const start = headerIndex(rows);
    expect(start).toBeGreaterThan(-1);
    expect(rows[start]).toEqual(["S.No", "Full name", "MAHE ID", "Department", "Marked at (IST)"]);

    const data = rows.slice(start + 1, start + 1 + ATTENDEES.length);
    expect(data).toHaveLength(ATTENDEES.length);

    ATTENDEES.forEach((attendee, index) => {
      expect(data[index]).toEqual([
        String(index + 1),
        attendee.name,
        attendee.collegeId ?? "—",
        attendee.department ?? "—",
        formatDateTime(attendee.markedAt),
      ]);
    });
  });

  it("uses a placeholder for missing optional fields instead of crashing", async () => {
    const workbook = await reopen(
      buildAttendanceWorkbook({ meeting: MEETING, attendees: ATTENDEES, faculty: [] }),
    );
    const rows = matrix(workbook.getWorksheet("Attendance Report")!);
    const start = headerIndex(rows);
    const last = rows[start + ATTENDEES.length];

    expect(last[0]).toBe("3");
    expect(last[1]).toBe("New Joiner Without Id");
    expect(last[2]).toBe("—");
    expect(last[3]).toBe("—");
  });

  it("includes a clear message when no attendees are marked", async () => {
    const workbook = await reopen(
      buildAttendanceWorkbook({ meeting: MEETING, attendees: [], faculty: [] }),
    );
    const rows = matrix(workbook.getWorksheet("Attendance Report")!);

    expect(rows).toContainEqual(["Total marked", "0"]);
    expect(headerIndex(rows)).toBeGreaterThan(-1);
    expect(rows.some((row) => row.join(" ").includes("No attendees marked"))).toBe(true);
  });

  it("does not truncate a long attendee list", async () => {
    const many: ExportAttendee[] = Array.from({ length: 250 }, (_, index) => ({
      name: `Attendee ${index + 1}`,
      collegeId: `MAHE${String(index + 1).padStart(7, "0")}`,
      department: "School of Computer Science Engineering",
      markedAt: new Date(Date.UTC(2026, 0, 2, 4, 35, 0) + index * 1000),
    }));

    const workbook = await reopen(buildAttendanceWorkbook({ meeting: MEETING, attendees: many, faculty: [] }));
    const rows = matrix(workbook.getWorksheet("Attendance Report")!);
    const start = headerIndex(rows);
    const data = rows.slice(start + 1, start + 1 + many.length);

    expect(data).toHaveLength(250);
    expect(data[0][0]).toBe("1");
    expect(data[249][0]).toBe("250");
    expect(data[249][1]).toBe("Attendee 250");
  });

  it("freezes the attendee header row", async () => {
    const workbook = await reopen(
      buildAttendanceWorkbook({ meeting: MEETING, attendees: ATTENDEES, faculty: [] }),
    );
    const view = workbook.getWorksheet("Attendance Report")!.views[0];
    expect(view?.state).toBe("frozen");
    if (view?.state !== "frozen") throw new Error("expected a frozen view");
    expect(view.ySplit).toBe(headerIndex(matrix(workbook.getWorksheet("Attendance Report")!)) + 1);
  });
});
