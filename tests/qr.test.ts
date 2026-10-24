import { describe, expect, it } from "vitest";

import { currentQrSlot, qrToken, verifyQrToken } from "../lib/qr";

describe("rotating QR tokens", () => {
  const now = 1_800_000_000_000;
  const meetingId = "11111111-1111-4111-8111-111111111111";
  const hostToken = "host-secret";
  const slot = currentQrSlot(now);

  it("verifies a token for the current slot", () => {
    expect(verifyQrToken(hostToken, meetingId, qrToken(hostToken, meetingId, slot), slot, now)).toBe(true);
  });

  it("accepts the previous two slots but not an older slot", () => {
    expect(verifyQrToken(hostToken, meetingId, qrToken(hostToken, meetingId, slot - 2), slot - 2, now)).toBe(true);
    expect(verifyQrToken(hostToken, meetingId, qrToken(hostToken, meetingId, slot - 3), slot - 3, now)).toBe(false);
  });

  it("rejects tampered, wrong-meeting, and future tokens", () => {
    expect(verifyQrToken(hostToken, meetingId, `${qrToken(hostToken, meetingId, slot)}x`, slot, now)).toBe(false);
    expect(verifyQrToken(hostToken, "22222222-2222-4222-8222-222222222222", qrToken(hostToken, meetingId, slot), slot, now)).toBe(false);
    expect(verifyQrToken(hostToken, meetingId, qrToken(hostToken, meetingId, slot + 1), slot + 1, now)).toBe(false);
  });
});
