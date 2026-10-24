"use client";

import { useEffect, useState } from "react";

import { COLLEGE_ID_MAX_LENGTH, COLLEGE_ID_REQUIRED, NAME_MAX_LENGTH } from "@/lib/config";
import { formatDateTime } from "@/lib/format";
import { GeolocationError, requestPosition, type Coordinates } from "@/lib/geolocation";

const DEVICE_STORAGE_KEY = "mqr-device-id";

function randomDeviceId(): string {
  const maybeCrypto = globalThis.crypto as
    | { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => void }
    | undefined;

  if (maybeCrypto?.randomUUID) return maybeCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (maybeCrypto?.getRandomValues) maybeCrypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readOrCreateDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,100}$/.test(existing)) return existing;
    const created = randomDeviceId();
    window.localStorage.setItem(DEVICE_STORAGE_KEY, created);
    return created;
  } catch {
    // Storage blocked (private mode / privacy settings): still works, just per-visit.
    return randomDeviceId();
  }
}

type Marked = { name: string; markedAt: string; title: string };

export function AttendForm({
  meetingId,
  title,
  requiresLocation,
  qrToken,
  qrSlot,
}: {
  meetingId: string;
  title: string;
  requiresLocation: boolean;
  qrToken: string | null;
  qrSlot: number | null;
}) {
  const [name, setName] = useState("");
  const [collegeId, setCollegeId] = useState("");
  const [department, setDepartment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [marked, setMarked] = useState<Marked | null>(null);
  const [faculty, setFaculty] = useState<Array<{ facultyId: string; name: string }>>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/faculty")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { members?: Array<{ facultyId?: string; name?: string }> } | null) => {
        if (!active || !data?.members) return;
        setFaculty(
          data.members.filter(
            (member): member is { facultyId: string; name: string } =>
              typeof member.facultyId === "string" && typeof member.name === "string",
          ),
        );
      })
      .catch(() => {
        // The roster is optional; manual entry remains available.
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    let coordinates: Coordinates | null = null;
    if (requiresLocation) {
      if (!window.isSecureContext) {
        setError("Location access needs HTTPS. Open this attendance link over a secure HTTPS connection.");
        setPending(false);
        return;
      }
      try {
        coordinates = await requestPosition();
      } catch (failure) {
        setError(
          failure instanceof GeolocationError
            ? failure.message
            : "Could not get your location. Allow location access and try again.",
        );
        setPending(false);
        return;
      }
    }

    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingId,
          name,
          collegeId,
          department,
          deviceId: readOrCreateDeviceId(),
          qrToken,
          qrSlot,
          lat: coordinates?.lat ?? null,
          lng: coordinates?.lng ?? null,
          accuracy: coordinates?.accuracy ?? null,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        name?: string;
        markedAt?: string;
        message?: string;
        distance_m?: number;
        accuracy_m?: number | null;
        radius_m?: number;
      };

      if (!response.ok) {
        const diagnostic =
          typeof data.distance_m === "number"
            ? ` (${data.distance_m} m away, allowed ${data.radius_m ?? "?"} m${
                typeof data.accuracy_m === "number" ? `, GPS accuracy ${data.accuracy_m} m` : ""
              })`
            : "";
        setError(`${data.message ?? "Could not mark attendance. Please try again."}${diagnostic}`);
        return;
      }

      setMarked({
        name: data.name ?? name.trim(),
        markedAt: data.markedAt ?? new Date().toISOString(),
        title,
      });
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (marked) {
    return (
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-3xl text-emerald-600">
          ✓
        </span>
        <div>
          <h2 className="font-serif text-2xl font-bold text-navy">Attendance marked</h2>
          <p className="mt-1 text-sm text-slate-500">
            for <span className="font-semibold text-navy">{marked.title}</span>
          </p>
        </div>
        <dl className="w-full rounded-xl border border-line bg-cream px-4 py-3 text-left text-sm">
          <div className="flex justify-between gap-4 py-1">
            <dt className="text-slate-500">Name</dt>
            <dd className="font-medium text-navy">{marked.name}</dd>
          </div>
          <div className="flex justify-between gap-4 py-1">
            <dt className="text-slate-500">Time</dt>
            <dd className="font-medium text-navy">{formatDateTime(marked.markedAt)}</dd>
          </div>
        </dl>
        <p className="text-xs text-slate-400">You can close this page now.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="department" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Department <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>
        </label>
        <input
          id="department"
          name="department"
          maxLength={100}
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
          placeholder="SOCE"
          className="field focus:field-focus"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Full name
        </label>
        <input
          id="name"
          name="name"
          required
          maxLength={NAME_MAX_LENGTH}
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Dr. A. Sharma"
          className="field focus:field-focus"
          list="faculty-names"
        />
        {faculty.length > 0 ? (
          <datalist id="faculty-names">
            {faculty.map((member) => (
              <option key={member.facultyId} value={member.name} />
            ))}
          </datalist>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="collegeId" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          College ID / roll no{" "}
          {COLLEGE_ID_REQUIRED ? null : (
            <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>
          )}
        </label>
        <input
          id="collegeId"
          name="collegeId"
          required={COLLEGE_ID_REQUIRED}
          maxLength={COLLEGE_ID_MAX_LENGTH}
          value={collegeId}
          onChange={(event) => setCollegeId(event.target.value)}
          placeholder="MAHE0023571"
          className="field focus:field-focus"
        />
      </div>

      {requiresLocation ? (
        <p className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-slate-600">
          <span aria-hidden className="text-gold">
            ◎
          </span>
          This meeting verifies you are on site. Allow location access when your browser asks.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex min-h-12 items-center justify-center rounded-xl bg-gold px-5 py-3 text-sm font-semibold text-white shadow-[0_6px_18px_-6px_rgba(182,127,63,0.8)] transition hover:bg-gold-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Marking…" : "Mark attendance"}
      </button>

      <p className="text-center text-xs text-slate-400">
        One mark per person and per device. Times are shown in IST.
      </p>
    </form>
  );
}
