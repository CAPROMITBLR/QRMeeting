import { describe, expect, it } from "vitest";

import { meetingWindowState } from "../lib/time-window";

describe("meetingWindowState", () => {
  const startsAt = new Date("2026-10-24T10:00:00.000Z");

  it("allows the configured early-entry window", () => {
    expect(meetingWindowState(new Date("2026-10-24T09:51:00.000Z"), startsAt, true, null)).toBe("open");
  });

  it("rejects attendance before the early-entry window", () => {
    expect(meetingWindowState(new Date("2026-10-24T09:49:00.000Z"), startsAt, true, null)).toBe("open");
  });

  it("closes at or after the deadline", () => {
    const closesAt = new Date("2026-10-24T11:00:00.000Z");
    expect(meetingWindowState(closesAt, startsAt, true, closesAt)).toBe("closed");
  });
});
