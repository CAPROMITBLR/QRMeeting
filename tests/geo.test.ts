import { describe, expect, it } from "vitest";

import { decideGeofence, haversineMeters } from "../lib/geo";

describe("haversineMeters", () => {
  it("returns zero for the same point", () => {
    expect(haversineMeters({ lat: 13.125, lng: 77.59 }, { lat: 13.125, lng: 77.59 })).toBe(0);
  });

  it("matches the known one-degree latitude distance", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  });
});

describe("decideGeofence", () => {
  it("allows a point whose uncertainty overlaps the radius", () => {
    const decision = decideGeofence({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, 100, 50);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("inside");
  });

  it("rejects a point outside the radius when accuracy cannot cover the gap", () => {
    const decision = decideGeofence({ lat: 0, lng: 0 }, { lat: 0, lng: 0.002 }, 100, 0);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("outside_range");
  });

  it("rejects accuracy above the configured maximum", () => {
    const decision = decideGeofence({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }, 100, 501);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("location_inaccurate");
  });

  it("accepts accuracy at the configured maximum", () => {
    expect(decideGeofence({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }, 100, 500).allowed).toBe(true);
  });

  it("accepts a venue-pin reading even when GPS accuracy is 135 m", () => {
    // Reported case: attendee stood on the venue pin and their phone reported ±135 m.
    const decision = decideGeofence(
      { lat: 12.865495, lng: 77.526067 },
      { lat: 12.865495, lng: 77.526067 },
      100,
      135,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("inside");
    expect(decision.distanceM).toBe(0);
  });
});
