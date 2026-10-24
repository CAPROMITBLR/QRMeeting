import { describe, expect, it } from "vitest";

import { attendeeUrl, qrFileName } from "../lib/qr";

describe("static QR links", () => {
  const meetingId = "11111111-1111-4111-8111-111111111111";

  it("creates an attendee URL without rotating token parameters", () => {
    expect(attendeeUrl("https://example.test/", meetingId)).toBe(`https://example.test/attend/${meetingId}`);
  });

  it("uses the final eight meeting-id characters for downloads", () => {
    expect(qrFileName("Ignored title", meetingId)).toBe("meeting_11111111.png");
  });
});
