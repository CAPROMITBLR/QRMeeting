import { describe, expect, it } from "vitest";

import {
  attendanceSchema,
  createMeetingSchema,
  hostCredentialsSchema,
  joinRequestSchema,
  updateMeetingSchema,
} from "../lib/schemas";

describe("attendance and meeting schemas", () => {
  it("requires latitude and longitude together", () => {
    const result = attendanceSchema.safeParse({
      meetingId: "11111111-1111-4111-8111-111111111111",
      name: "A. Person",
      deviceId: "device_1234",
      lat: 13.1,
      lng: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed PATCH close times", () => {
    expect(updateMeetingSchema.safeParse({ closes_at: "not-a-date" }).success).toBe(false);
  });

  it("accepts a join request without coordinates and defaults the reason", () => {
    const result = joinRequestSchema.safeParse({
      meetingId: "11111111-1111-4111-8111-111111111111",
      name: "A. Person",
      deviceId: "device_1234",
    });
    expect(result.success).toBe(true);
    expect(result.data?.reason).toBe("outside_range");
  });

  it("requires a real passphrase for host accounts", () => {
    expect(hostCredentialsSchema.safeParse({ name: "Dr. A", passphrase: "short", mode: "signup" }).success).toBe(
      false,
    );
    expect(hostCredentialsSchema.safeParse({ name: "Dr. A", passphrase: "long-enough-1", mode: "signin" }).success).toBe(
      true,
    );
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
