export type Coordinates = { lat: number; lng: number; accuracy: number };

export type GeolocationFailureCode = "unsupported" | "denied" | "unavailable" | "timeout";

export class GeolocationError extends Error {
  code: GeolocationFailureCode;

  constructor(code: GeolocationFailureCode, message: string) {
    super(message);
    this.name = "GeolocationError";
    this.code = code;
  }
}

const MESSAGES: Record<GeolocationFailureCode, string> = {
  unsupported:
    "This browser can't share your location. Open this page on a phone with location services on.",
  denied:
    "Location permission was blocked. Allow location access for this site in your browser settings, then try again.",
  unavailable:
    "Your location is unavailable right now. Check that location services are switched on and try again.",
  timeout: "Getting your location took too long. Step outside or near a window and try again.",
};

export function requestPosition(options?: {
  timeoutMs?: number;
  highAccuracy?: boolean;
  maximumAgeMs?: number;
}): Promise<Coordinates> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(new GeolocationError("unsupported", MESSAGES.unsupported));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        const code: GeolocationFailureCode =
          error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable";
        reject(new GeolocationError(code, MESSAGES[code]));
      },
      {
        enableHighAccuracy: options?.highAccuracy ?? false,
        timeout: options?.timeoutMs ?? 15_000,
        maximumAge: options?.maximumAgeMs ?? 30_000,
      },
    );
  });
}
