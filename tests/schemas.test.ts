import { describe, expect, it } from "vitest";

import {
  attendanceSchema,
  createMeetingSchema,
  facultyReportSchema,
  joinRequestSchema,
  updateMeetingSchema,
} from "../lib/schemas";

const MEETING_ID = "11111111-1111-4111-8111-111111111111";

describe("attendance and meeting schemas", () => {
  it("requires latitude and longitude together", () => {
    const result = attendanceSchema.safeParse({
      meetingId: MEETING_ID,
      name: "A. Person",
      collegeId: "MAHE0023571",
      deviceId: "device_1234",
      lat: 13.1,
      lng: null,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["lat"]);
  });

  it("completes a MAHE ID typed without its prefix, and accepts none at all", () => {
    const typed = attendanceSchema.safeParse({
      meetingId: MEETING_ID,
      name: "A. Person",
      collegeId: "0023571",
      deviceId: "device_1234",
    });
    expect(typed.success).toBe(true);
    expect(typed.data?.collegeId).toBe("MAHE0023571");

    const prefixed = attendanceSchema.safeParse({
      meetingId: MEETING_ID,
      name: "A. Person",
      collegeId: "mahe 0023571",
      deviceId: "device_1234",
    });
    expect(prefixed.data?.collegeId).toBe("MAHE0023571");

    // One faculty member has no ID issued yet, so it stays optional.
    const withoutId = attendanceSchema.safeParse({
      meetingId: MEETING_ID,
      name: "A. Person",
      deviceId: "device_1234",
    });
    expect(withoutId.success).toBe(true);
    expect(withoutId.data?.collegeId).toBe("");
  });

  it("rejects malformed PATCH close times", () => {
    expect(updateMeetingSchema.safeParse({ closes_at: "not-a-date" }).success).toBe(false);
  });

  it("accepts a join request without coordinates and defaults the reason", () => {
    const result = joinRequestSchema.safeParse({
      meetingId: MEETING_ID,
      name: "A. Person",
      collegeId: "MAHE0023571",
      deviceId: "device_1234",
    });
    expect(result.success).toBe(true);
    expect(result.data?.reason).toBe("outside_range");
  });

  it("rejects a creation close time before the start", () => {
    const result = createMeetingSchema.safeParse({
      title: "Meeting",
      startsAt: "2026-10-24T10:00:00.000Z",
      closesAt: "2026-10-24T09:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("facultyReportSchema", () => {
  it("accepts a bare missing-ID report and defaults the reason", () => {
    const result = facultyReportSchema.safeParse({ meetingId: MEETING_ID, note: "  my ID is not listed  " });
    expect(result.success).toBe(true);
    expect(result.data?.reason).toBe("id_missing");
    expect(result.data?.note).toBe("my ID is not listed");
    expect(result.data?.maheId).toBe("");
  });

  it("normalises a typed MAHE ID and accepts the other reasons", () => {
    const result = facultyReportSchema.safeParse({
      meetingId: MEETING_ID,
      maheId: "mahe-0023571",
      reason: "details_incorrect",
      deviceId: "device_1234",
    });
    expect(result.success).toBe(true);
    expect(result.data?.maheId).toBe("MAHE0023571");
  });

  it("rejects an unknown reason, a bad meeting id and an oversized note", () => {
    expect(facultyReportSchema.safeParse({ meetingId: MEETING_ID, reason: "whatever" }).success).toBe(false);
    expect(facultyReportSchema.safeParse({ meetingId: "not-a-uuid" }).success).toBe(false);
    expect(
      facultyReportSchema.safeParse({ meetingId: MEETING_ID, note: "x".repeat(501) }).success,
    ).toBe(false);
  });
});
