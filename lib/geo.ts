import { ACCURACY_BUFFER_M, MAX_ACCURACY_M } from "@/lib/config";

export type Coordinate = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in metres. */
export function haversineMeters(from: Coordinate, to: Coordinate): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type GeofenceDecision = {
  allowed: boolean;
  distanceM: number;
  accuracyM: number | null;
  effectiveDistanceM: number;
  radiusM: number;
  reason: "inside" | "outside_range" | "location_inaccurate";
};

export function decideGeofence(
  venue: Coordinate,
  user: Coordinate,
  radiusM: number,
  accuracyM: number | null,
): GeofenceDecision {
  const distanceM = haversineMeters(venue, user);
  if (accuracyM !== null && accuracyM > MAX_ACCURACY_M) {
    return {
      allowed: false,
      distanceM,
      accuracyM,
      effectiveDistanceM: distanceM,
      radiusM,
      reason: "location_inaccurate",
    };
  }

  const effectiveDistanceM = distanceM - Math.min(accuracyM ?? 0, ACCURACY_BUFFER_M);
  const allowed = effectiveDistanceM <= radiusM;
  return {
    allowed,
    distanceM,
    accuracyM,
    effectiveDistanceM,
    radiusM,
    reason: allowed ? "inside" : "outside_range",
  };
}
