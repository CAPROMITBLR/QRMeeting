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

  const timeoutMs = options?.timeoutMs ?? 15_000;
  const getOptions: PositionOptions = {
    enableHighAccuracy: true,
    timeout: timeoutMs,
    maximumAge: 0,
  };

  function toCoordinates(position: GeolocationPosition): Coordinates {
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
  }

  function failureCode(error: GeolocationPositionError): GeolocationFailureCode {
    return error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable";
  }

  function retryWithWatch(initialFailure: GeolocationError | null, initial: Coordinates | null): Promise<Coordinates> {
    return new Promise((resolve, reject) => {
      let best = initial;
      let watchId: number | null = null;
      const finish = (result?: Coordinates, failure?: GeolocationError) => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        window.clearTimeout(timer);
        if (result) resolve(result);
        else reject(failure ?? initialFailure ?? new GeolocationError("timeout", MESSAGES.timeout));
      };
      const timer = window.setTimeout(() => finish(best ?? undefined), 10_000);
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const current = toCoordinates(position);
          if (!best || current.accuracy < best.accuracy) best = current;
          if (current.accuracy <= 100) finish(current);
        },
        (error) => finish(best ?? undefined, best ? undefined : new GeolocationError(failureCode(error), MESSAGES[failureCode(error)])),
        getOptions,
      );
    });
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates = toCoordinates(position);
        if (coordinates.accuracy <= 100) {
          resolve(coordinates);
        } else {
          retryWithWatch(null, coordinates).then(resolve, reject);
        }
      },
      (error) => {
        const failure = new GeolocationError(failureCode(error), MESSAGES[failureCode(error)]);
        if (failure.code === "timeout") {
          retryWithWatch(failure, null).then(resolve, reject);
        } else {
          reject(failure);
        }
      },
      getOptions,
    );
  });
}
