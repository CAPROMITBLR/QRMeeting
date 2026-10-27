"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { DEFAULT_RADIUS_M } from "@/lib/config";
import { GeolocationError, requestPosition } from "@/lib/geolocation";
import { saveMeeting } from "@/lib/saved-meetings";
import { istDateTimeInput, parseIstDateTime } from "@/lib/timezone";

function localDateTimeInput(date: Date): string {
  return istDateTimeInput(date);
}

function todayIst(): string {
  return localDateTimeInput(new Date()).split("T")[0] ?? "";
}

export function CreateMeetingForm() {
  const router = useRouter();
  const startsAtDateRef = useRef<HTMLInputElement>(null);
  const startsAtTimeRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS_M));
  const [durationMinutes, setDurationMinutes] = useState("");
  const [startsAtDate, setStartsAtDate] = useState("");
  const [startsAtTime, setStartsAtTime] = useState("");
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationCaptured, setLocationCaptured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const today = todayIst();

  // Seeded on the client so the value matches the visitor's clock and timezone.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = localDateTimeInput(new Date());
      const [date, time] = value.split("T");
      setStartsAtDate(date ?? "");
      setStartsAtTime(time ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function useCurrentLocation() {
    setLocationNote(null);
    setLocationCaptured(false);
    setError(null);
    setLocating(true);
    try {
      const position = await requestPosition();
      setLat(position.lat.toFixed(6));
      setLng(position.lng.toFixed(6));
      setLocationCaptured(true);
      setLocationNote(
        `Saved venue point from your current position (GPS accuracy ±${Math.round(position.accuracy)} m).`,
      );
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

  function clearLocation() {
    setLat("");
    setLng("");
    setRadius(String(DEFAULT_RADIUS_M));
    setLocationNote(null);
    setLocationCaptured(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const startsAt =
      startsAtDate && startsAtTime ? `${startsAtDate}T${startsAtTime}` : "";
    const hasLat = lat.trim() !== "";
    const hasLng = lng.trim() !== "";

    if (hasLat !== hasLng) {
      setError(
        "Enter both latitude and longitude, or leave both empty to skip the geofence.",
      );
      setPending(false);
      return;
    }

    const latNumber = hasLat ? Number(lat) : null;
    const lngNumber = hasLng ? Number(lng) : null;
    if (
      (latNumber !== null && !Number.isFinite(latNumber)) ||
      (lngNumber !== null && !Number.isFinite(lngNumber))
    ) {
      setError("Latitude and longitude must be numbers.");
      setPending(false);
      return;
    }

    const radiusNumber = Number(radius);

    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          startsAt: parseIstDateTime(startsAt)?.toISOString() ?? "",
          lat: latNumber,
          lng: lngNumber,
          radiusM: Number.isFinite(radiusNumber)
            ? radiusNumber
            : DEFAULT_RADIUS_M,
          durationMinutes: durationMinutes ? Number(durationMinutes) : null,
        }),
      });
      const data = (await response.json()) as {
        id?: string;
        hostToken?: string;
        message?: string;
      };

      if (!response.ok || !data.id || !data.hostToken) {
        setError(data.message ?? "Could not create the meeting.");
        return;
      }

      // No accounts: remember the link in this browser so it can be reopened,
      // and the link itself still works anywhere.
      saveMeeting({ id: data.id, title: title.trim(), key: data.hostToken });
      router.push(
        `/meetings/${data.id}?key=${encodeURIComponent(data.hostToken)}`,
      );
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="durationMinutes"
          className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500"
        >
          Meeting / QR duration{" "}
          <span className="font-normal normal-case tracking-normal text-slate-400">
            (optional)
          </span>
        </label>
        <select
          id="durationMinutes"
          value={durationMinutes}
          onChange={(event) => setDurationMinutes(event.target.value)}
          className="field focus:field-focus"
        >
          <option value="">No automatic expiry</option>
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
          <option value="90">1 hour 30 minutes</option>
          <option value="120">2 hours</option>
          <option value="180">3 hours</option>
        </select>
        <p className="text-[11px] text-slate-400">
          Attendance and the QR close automatically when this duration ends.
          Leave it empty to close attendance manually from the host page.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="title"
          className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500"
        >
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
        <label
          htmlFor="startsAt"
          className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500"
        >
          Date and time (IST)
        </label>
        <div className="grid grid-cols-2 gap-2">
          <input
            id="startsAtDate"
            name="startsAtDate"
            ref={startsAtDateRef}
            type="date"
            min={today}
            required
            value={startsAtDate}
            onChange={(event) => setStartsAtDate(event.target.value)}
            className="field focus:field-focus"
          />
          <input
            id="startsAtTime"
            name="startsAtTime"
            ref={startsAtTimeRef}
            type="time"
            required
            value={startsAtTime}
            onChange={(event) => setStartsAtTime(event.target.value)}
            className="field focus:field-focus"
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-xl border border-line bg-cream/60 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Venue geofence{" "}
          <span className="font-normal normal-case tracking-normal text-slate-400">
            (optional)
          </span>
        </legend>
        <p className="text-xs text-slate-500">
          Add the venue coordinates to only accept attendance from people on
          site.
        </p>

        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:opacity-60 ${
            locationCaptured
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-gold/40 bg-white text-gold-dark hover:border-gold"
          }`}
        >
          {locating
            ? "Finding your location…"
            : locationCaptured
              ? "Location captured!"
              : "Use my current location"}
        </button>

        {lat || lng ? (
          <button
            type="button"
            onClick={clearLocation}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
          >
            Clear venue location
          </button>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="lat"
              className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500"
            >
              Latitude
            </label>
            <input
              id="lat"
              name="lat"
              type="number"
              step="any"
              inputMode="decimal"
              value={lat}
              onChange={(event) => {
                setLat(event.target.value);
                setLocationNote(null);
              }}
              placeholder="13.125128"
              className="field focus:field-focus font-mono"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="lng"
              className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500"
            >
              Longitude
            </label>
            <input
              id="lng"
              name="lng"
              type="number"
              step="any"
              inputMode="decimal"
              value={lng}
              onChange={(event) => {
                setLng(event.target.value);
                setLocationNote(null);
              }}
              placeholder="77.589878"
              className="field focus:field-focus font-mono"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="radius"
            className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500"
          >
            Radius (m)
          </label>
          <input
            id="radius"
            name="radius"
            type="number"
            min={10}
            max={5000}
            step={5}
            inputMode="numeric"
            value={radius}
            onChange={(event) => setRadius(event.target.value)}
            className="field focus:field-focus w-24 py-2"
          />
        </div>

        {locationNote ? (
          <p className="text-[11px] text-emerald-700">{locationNote}</p>
        ) : null}
      </fieldset>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || locating}
        className="mt-1 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-gold px-5 py-3 text-sm font-semibold text-white shadow-[0_6px_18px_-6px_rgba(182,127,63,0.8)] transition hover:bg-gold-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending
          ? "Creating…"
          : locating
            ? "Waiting for location…"
            : "Create meeting"}
      </button>

      <p className="text-center text-xs text-slate-400">
        The host link is saved in this browser — keep the link itself to open
        the meeting elsewhere.
      </p>
    </form>
  );
}
