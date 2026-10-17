"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { DEFAULT_RADIUS_M, RADIUS_MAX_M, RADIUS_MIN_M } from "@/lib/config";
import { GeolocationError, requestPosition } from "@/lib/geolocation";
import { saveHostLink } from "@/lib/host-links";

function localDateTimeInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CreateMeetingForm() {
  const router = useRouter();
  const startsAtRef = useRef<HTMLInputElement>(null);
  const closesAtRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS_M));
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Seeded on the client so the value matches the visitor's clock and timezone.
  useEffect(() => {
    const input = startsAtRef.current;
    if (input && !input.value) input.value = localDateTimeInput(new Date(Date.now() + 60 * 60 * 1000));
  }, []);

  async function useCurrentLocation() {
    setLocationNote(null);
    setError(null);
    setLocating(true);
    try {
      const position = await requestPosition();
      setLat(position.lat.toFixed(6));
      setLng(position.lng.toFixed(6));
      setLocationNote(`Using your current position (±${Math.round(position.accuracy)} m).`);
    } catch (failure) {
      setError(
        failure instanceof GeolocationError
          ? failure.message
          : "Could not get your location. Enter the coordinates manually instead.",
      );
    } finally {
      setLocating(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const startsAt = startsAtRef.current?.value ?? "";
    const hasLat = lat.trim() !== "";
    const hasLng = lng.trim() !== "";

    if (hasLat !== hasLng) {
      setError("Enter both latitude and longitude, or leave both empty to skip the geofence.");
      setPending(false);
      return;
    }

    const latNumber = hasLat ? Number(lat) : null;
    const lngNumber = hasLng ? Number(lng) : null;
    if ((latNumber !== null && !Number.isFinite(latNumber)) || (lngNumber !== null && !Number.isFinite(lngNumber))) {
      setError("Latitude and longitude must be numbers.");
      setPending(false);
      return;
    }

    const radiusNumber = Number(radius);
    const closesAt = closesAtRef.current?.value ?? "";

    if (closesAt && startsAt && new Date(closesAt).getTime() <= new Date(startsAt).getTime()) {
      setError("Auto-close must be after the meeting start.");
      setPending(false);
      return;
    }

    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          startsAt: startsAt ? new Date(startsAt).toISOString() : "",
          lat: latNumber,
          lng: lngNumber,
          radiusM: Number.isFinite(radiusNumber) ? radiusNumber : DEFAULT_RADIUS_M,
          closesAt: closesAt ? new Date(closesAt).toISOString() : null,
        }),
      });
      const data = (await response.json()) as { id?: string; hostToken?: string; message?: string };

      if (!response.ok || !data.id || !data.hostToken) {
        setError(data.message ?? "Could not create the meeting.");
        return;
      }

      saveHostLink({
        id: data.id,
        title: title.trim(),
        key: data.hostToken,
        startsAt: startsAt ? new Date(startsAt).toISOString() : new Date().toISOString(),
      });
      router.push(`/meetings/${data.id}?key=${encodeURIComponent(data.hostToken)}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Meeting title
        </label>
        <input
          id="title"
          name="title"
          required
          maxLength={120}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Faculty Coordination Meeting"
          className="field focus:field-focus"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="startsAt" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Date and time
        </label>
        <input
          id="startsAt"
          name="startsAt"
          ref={startsAtRef}
          type="datetime-local"
          required
          className="field focus:field-focus"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="closesAt" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Auto-close at <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>
        </label>
        <input
          id="closesAt"
          name="closesAt"
          ref={closesAtRef}
          type="datetime-local"
          className="field focus:field-focus"
        />
        <p className="text-[11px] text-slate-400">
          Leave empty to close attendance manually. You can change this later from the host page.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-xl border border-line bg-cream/60 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Venue geofence <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>
        </legend>
        <p className="text-xs text-slate-500">
          Add the venue coordinates to only accept attendance from people on site.
        </p>

        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-gold/40 bg-white px-3 py-2 text-xs font-semibold text-gold-dark transition hover:border-gold disabled:opacity-60"
        >
          {locating ? "Finding you…" : "Use my current location"}
        </button>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="lat" className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
              Latitude
            </label>
            <input
              id="lat"
              name="lat"
              type="number"
              step="any"
              inputMode="decimal"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
              placeholder="13.125128"
              className="field focus:field-focus font-mono"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="lng" className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
              Longitude
            </label>
            <input
              id="lng"
              name="lng"
              type="number"
              step="any"
              inputMode="decimal"
              value={lng}
              onChange={(event) => setLng(event.target.value)}
              placeholder="77.589878"
              className="field focus:field-focus font-mono"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="radius" className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
            Radius (m)
          </label>
          <input
            id="radius"
            name="radius"
            type="number"
            min={RADIUS_MIN_M}
            max={RADIUS_MAX_M}
            step={10}
            inputMode="numeric"
            value={radius}
            onChange={(event) => setRadius(event.target.value)}
            className="field focus:field-focus w-24 py-2"
          />
        </div>

        {locationNote ? <p className="text-[11px] text-emerald-700">{locationNote}</p> : null}
      </fieldset>

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-gold px-5 py-3 text-sm font-semibold text-white shadow-[0_6px_18px_-6px_rgba(182,127,63,0.8)] transition hover:bg-gold-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create meeting"}
      </button>

      <p className="text-center text-xs text-slate-400">
        You&apos;ll get a private host link with the QR code. Bookmark it.
      </p>
    </form>
  );
}
