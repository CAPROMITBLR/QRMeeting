"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { FACULTY_NOTE_MAX_LENGTH, NAME_MAX_LENGTH } from "@/lib/config";
import {
  departmentOptions,
  filterSortedById,
  filterSortedByName,
  formatMaheId,
  idDigits,
  maheIdDigits,
  sortById,
  sortByName,
  type FacultyMember,
} from "@/lib/faculty-directory";
import { formatDateTime } from "@/lib/format";
import {
  GeolocationError,
  requestPosition,
  type Coordinates,
} from "@/lib/geolocation";

const DEVICE_STORAGE_KEY = "mqr-device-id";

/** Keeps the suggestion list light; typing narrows it anyway. */
const MAX_SUGGESTIONS = 100;

const REPORT_REASONS = [
  { value: "id_missing", label: "My MAHE ID isn't in the directory" },
  { value: "details_incorrect", label: "My name or department is wrong" },
  { value: "other", label: "Something else" },
] as const;

type ReportReason = (typeof REPORT_REASONS)[number]["value"];

function randomDeviceId(): string {
  const maybeCrypto = globalThis.crypto as
    | {
        randomUUID?: () => string;
        getRandomValues?: (array: Uint8Array) => void;
      }
    | undefined;

  if (maybeCrypto?.randomUUID) return maybeCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (maybeCrypto?.getRandomValues) maybeCrypto.getRandomValues(bytes);
  else
    for (let index = 0; index < bytes.length; index++)
      bytes[index] = Math.floor(Math.random() * 256);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
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
  meetingLatitude,
  meetingLongitude,
  meetingRadius,
}: {
  meetingId: string;
  title: string;
  requiresLocation: boolean;
  meetingLatitude: number | null;
  meetingLongitude: number | null;
  meetingRadius: number | null;
}) {
  const [roster, setRoster] = useState<FacultyMember[] | null>(null);
  const [departments, setDepartments] = useState<string[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [idValue, setIdValue] = useState("");
  const [department, setDepartment] = useState("");
  const [activeField, setActiveField] = useState<"name" | "id" | null>(null);
  const [matched, setMatched] = useState<FacultyMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [marked, setMarked] = useState<Marked | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [joinReason, setJoinReason] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestSent, setRequestSent] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestDeclined, setRequestDeclined] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("id_missing");
  const [reportNote, setReportNote] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const [nameCommitted, setNameCommitted] = useState(false);
  const [nameListPinned, setNameListPinned] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // The directory is fetched once: both search fields and the department
  // dropdown all work off the same list, in the browser.
  useEffect(() => {
    let active = true;
    fetch("/api/faculty", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          data: { members?: FacultyMember[]; departments?: string[] } | null,
        ) => {
          if (!active) return;
          if (!data || !Array.isArray(data.members)) {
            setRoster([]);
            setRosterError(
              "Could not load the faculty directory. You can still type your own details.",
            );
            return;
          }
          setRoster(data.members);
          setDepartments(
            Array.isArray(data.departments)
              ? data.departments
              : departmentOptions(data.members),
          );
        },
      )
      .catch(() => {
        if (!active) return;
        setRoster([]);
        setRosterError(
          "Could not load the faculty directory. You can still type your own details.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  // The roster is sorted once when it loads; filtering below just walks the
  // pre-sorted arrays instead of re-sorting on every keystroke.
  const sortedByName = useMemo(
    () => (roster ? sortByName(roster) : []),
    [roster],
  );
  const sortedById = useMemo(
    () =>
      roster ? sortById(roster.filter((member) => member.maheId !== null)) : [],
    [roster],
  );
  const nameIndex = useMemo(() => {
    const index = new Map<string, FacultyMember[]>();
    if (!roster) return index;
    for (const member of roster) {
      const key = member.name.trim().toLowerCase();
      const bucket = index.get(key);
      if (bucket) bucket.push(member);
      else index.set(key, [member]);
    }
    return index;
  }, [roster]);

  const suggestions = useMemo(() => {
    const none: FacultyMember[] = [];
    if (!roster || activeField === null) return { all: none, shown: none };
    const all =
      activeField === "name"
        ? filterSortedByName(sortedByName, name)
        : filterSortedById(sortedById, idValue);
    return { all, shown: all.slice(0, MAX_SUGGESTIONS) };
  }, [roster, activeField, name, idValue, sortedByName, sortedById]);

  const exactNameMatches = useMemo(() => {
    const key = name.trim().toLowerCase();
    if (!key) return [];
    return nameIndex.get(key) ?? [];
  }, [name, nameIndex]);

  // Surface validation errors instead of leaving them below the fold.
  useEffect(() => {
    if (error)
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);

  function chooseMember(member: FacultyMember) {
    setName(member.name);
    setIdValue(maheIdDigits(member.maheId));
    setDepartment(member.department);
    setMatched(member);
    setActiveField(null);
    setNameListPinned(false);
    setError(null);
    setReportMessage(null);
  }

  /** Arrow keys move through the open suggestion list; Enter picks the highlighted row. */
  function handleListKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const list = suggestions.shown;
    if (activeField === null || list.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => (index + 1) % list.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => (index - 1 + list.length) % list.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      chooseMember(list[Math.min(highlighted, list.length - 1)]);
    } else if (event.key === "Escape") {
      setActiveField(null);
      setNameListPinned(false);
    }
  }

  /** Any edit after picking a row means the fields no longer describe that row. */
  function markDirty() {
    if (matched) setMatched(null);
  }

  async function submitMark(coordinates: Coordinates | null) {
    const response = await fetch("/api/attendance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        meetingId,
        name: name.trim(),
        collegeId: formatMaheId(idValue),
        department: department.trim(),
        deviceId: readOrCreateDeviceId(),
        lat: coordinates?.lat ?? null,
        lng: coordinates?.lng ?? null,
        accuracy: coordinates?.accuracy ?? null,
      }),
    });
    const data = (await response.json()) as {
      ok?: boolean;
      name?: string;
      markedAt?: string;
      error?: string;
      message?: string;
      can_request_join?: boolean;
    };

    if (!response.ok) {
      setError(data.message ?? "We could not mark your attendance.");
      if (data.can_request_join && response.status === 403) {
        setJoinReason(data.error ?? "outside_range");
      }
      return;
    }

    setMarked({
      name: data.name ?? name.trim(),
      markedAt: data.markedAt ?? new Date().toISOString(),
      title,
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setReportMessage(null);

    if (name.trim().length === 0) {
      setError("Enter your name before marking attendance.");
      return;
    }
    if (department.trim().length === 0) {
      setError(
        departments.length > 0
          ? "Choose your department from the list."
          : "Enter your department.",
      );
      return;
    }

    setPending(true);
    setError(null);
    setJoinReason(null);
    setRequestError(null);

    let position: Coordinates | null = null;
    if (requiresLocation) {
      if (!window.isSecureContext) {
        setError(
          "Location access needs HTTPS. Open this attendance link over a secure HTTPS connection.",
        );
        setPending(false);
        return;
      }
      try {
        position = await requestPosition();
        setCoordinates(position);
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
      await submitMark(position);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  // Poll the request so an approval turns into the usual success card.
  useEffect(() => {
    if (!requestId) return;
    let active = true;

    const check = async () => {
      try {
        const response = await fetch(`/api/join-requests/${requestId}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          status?: string;
          markedAt?: string | null;
        };
        if (!active) return;
        if (data.status === "approved") {
          setRequestId(null);
          setRequestSent(null);
          setMarked({
            name: name.trim() || "You",
            markedAt: data.markedAt ?? new Date().toISOString(),
            title,
          });
        } else if (data.status === "rejected") {
          setRequestId(null);
          setRequestSent(null);
          setRequestDeclined(true);
        }
      } catch {
        // Keep polling; a transient network error is not a decision.
      }
    };

    void check();
    const timer = window.setInterval(check, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [requestId, name, title]);

  async function requestToJoin() {
    if (name.trim().length === 0) {
      setRequestError("Enter your name first.");
      return;
    }
    setRequesting(true);
    setRequestError(null);
    setRequestDeclined(false);
    try {
      const response = await fetch("/api/join-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingId,
          name: name.trim(),
          collegeId: formatMaheId(idValue),
          department: department.trim(),
          deviceId: readOrCreateDeviceId(),
          lat: coordinates?.lat ?? null,
          lng: coordinates?.lng ?? null,
          accuracy: coordinates?.accuracy ?? null,
          reason: joinReason ?? "outside_range",
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        requestId?: string;
      };
      if (!response.ok) {
        setRequestError(data.message ?? "Could not send your request to join.");
        if (
          data.error === "duplicate_name" ||
          data.error === "duplicate_device"
        )
          setJoinReason(null);
        return;
      }
      setRequestSent(
        data.message ??
          "Request sent. The host can accept or reject it from the attendance page.",
      );
      setJoinReason(null);
      setError(null);
      setRequestId(data.requestId ?? null);
    } catch {
      setRequestError(
        "Network error. Please check your connection and try again.",
      );
    } finally {
      setRequesting(false);
    }
  }

  function toggleReport() {
    setReportOpen((open) => {
      const next = !open;
      if (next) {
        setReportReason(matched ? "details_incorrect" : "id_missing");
        setReportMessage(null);
        setReportError(null);
      }
      return next;
    });
  }

  async function sendReport() {
    setReportSending(true);
    setReportError(null);
    setReportMessage(null);
    try {
      const response = await fetch("/api/faculty/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingId,
          maheId: formatMaheId(idValue),
          name: name.trim(),
          department: department.trim(),
          reason: reportReason,
          note: reportNote,
          deviceId: readOrCreateDeviceId(),
        }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        setReportError(data.message ?? "Could not send your report right now.");
        return;
      }
      setReportMessage(data.message ?? "Report sent.");
      setReportNote("");
      setReportOpen(false);
    } catch {
      setReportError(
        "Network error. Please check your connection and try again.",
      );
    } finally {
      setReportSending(false);
    }
  }

  const markedLocation = coordinates
    ? `${coordinates.lat.toFixed(6)}, ${coordinates.lng.toFixed(6)} (±${Math.round(coordinates.accuracy)} m)`
    : meetingLatitude !== null && meetingLongitude !== null
      ? `${meetingLatitude.toFixed(6)}, ${meetingLongitude.toFixed(6)} (venue)`
      : "Not recorded";

  if (marked) {
    return (
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-3xl text-emerald-600">
          ✓
        </span>
        <div>
          <h2 className="font-serif text-2xl font-bold text-navy">
            Attendance marked
          </h2>
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
            <dt className="text-slate-500">MAHE ID</dt>
            <dd className="font-mono text-xs font-medium text-navy">
              {formatMaheId(idValue) || "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4 py-1">
            <dt className="text-slate-500">Department</dt>
            <dd className="text-right font-medium text-navy">
              {department || "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4 py-1">
            <dt className="text-slate-500">Time</dt>
            <dd className="font-medium text-navy">
              {formatDateTime(marked.markedAt)}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line/60 pt-1.5">
            <dt className="text-slate-500">Location</dt>
            <dd className="text-right font-mono text-[11px] font-medium text-navy">
              {markedLocation}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-slate-400">You can close this page now.</p>
      </div>
    );
  }

  const showNameList =
    (activeField === "name" || nameListPinned) && roster !== null;
  /**
   * The department stays locked until the person has entered a name the
   * directory does not know: that is the manual-flow branch where they pick
   * their department themselves. A directory name auto-fills and locks it.
   */
  const departmentUnlocked =
    matched === null && nameCommitted && name.trim() !== "";

  function toggleNameList() {
    if (!showNameList) {
      setNameListPinned(true);
      setActiveField("name");
    } else {
      setNameListPinned(false);
      setActiveField(null);
    }
    setHighlighted(0);
  }
  const showIdList = activeField === "id" && roster !== null;
  const nameMatches = showNameList ? suggestions.shown : [];
  const idMatches = showIdList ? suggestions.shown : [];
  const hiddenMatches = suggestions.all.length - suggestions.shown.length;
  const activeOptionId = (listId: string) =>
    suggestions.shown.length > 0
      ? `${listId}-option-${Math.min(highlighted, suggestions.shown.length - 1)}`
      : undefined;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-cream/60 px-4 py-3 text-xs text-slate-600">
        <p className="font-semibold uppercase tracking-[0.12em] text-slate-500">
          Meeting location
        </p>
        {meetingLatitude !== null && meetingLongitude !== null ? (
          <p className="mt-1 font-mono text-[11px] text-navy">
            {meetingLatitude.toFixed(6)}, {meetingLongitude.toFixed(6)}
            {meetingRadius !== null
              ? ` · allowed radius ${meetingRadius} m`
              : ""}
          </p>
        ) : (
          <p className="mt-1">
            This meeting does not use location verification.
          </p>
        )}
        {coordinates ? (
          <p className="mt-2 border-t border-line pt-2 font-mono text-[11px] text-emerald-700">
            Your location: {coordinates.lat.toFixed(6)},{" "}
            {coordinates.lng.toFixed(6)}
            <br />
            GPS accuracy: ±{Math.round(coordinates.accuracy)} m
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="name"
          className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500"
        >
          Full name
        </label>
        <div className="relative">
        <input
          id="name"
          name="name"
          required
          maxLength={NAME_MAX_LENGTH}
          autoComplete="name"
          role="combobox"
          aria-expanded={showNameList}
          aria-controls="name-suggestions"
          aria-activedescendant={
            showNameList ? activeOptionId("name-suggestions") : undefined
          }
          value={name}
          onChange={(event) => {
            const typed = event.target.value;
            setName(typed);
            setNameCommitted(false);
            // A cleared name leaves the form with no one in it: drop a
            // department choice so nothing stale survives the reset.
            if (typed.trim() === "") setDepartment("");
            markDirty();
            setHighlighted(0);
            // A full name typed out lands on exactly one person: fill the rest
            // and lock it, the same as picking them from the list.
            const exact = nameIndex.get(typed.trim().toLowerCase()) ?? [];
            if (exact.length === 1) {
              chooseMember(exact[0]);
              return;
            }
            setActiveField("name");
          }}
          onKeyDown={handleListKeyDown}
          onFocus={() => {
            setActiveField("name");
            setHighlighted(0);
          }}
          onBlur={() => {
            // Leaving the name field commits it: a name the directory knows
            // has usually auto-picked already, anything else unlocks the
            // department for the manual flow.
            setActiveField(null);
            if (name.trim() !== "") setNameCommitted(true);
          }}
          placeholder="Type your name as it appears in the directory"
          className="field focus:field-focus pr-10"
        />
          <button
            type="button"
            aria-label={showNameList ? "Hide the name list" : "Show the full name list"}
            // Keeps focus in the input so the list does not close on mousedown.
            onMouseDown={(event) => event.preventDefault()}
            onClick={toggleNameList}
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-cream hover:text-navy"
          >
            <ChevronIcon open={showNameList} />
          </button>
        </div>
        {roster === null && !rosterError ? (
          <p className="text-[11px] text-slate-400">
            Loading the faculty directory…
          </p>
        ) : null}
        {showNameList && exactNameMatches.length > 1 ? (
          <p className="text-[11px] text-amber-700">
            {exactNameMatches.length} people share “{name.trim()}” — pick the
            right person below.
          </p>
        ) : null}
        {showNameList ? (
          <SuggestionList
            id="name-suggestions"
            members={nameMatches}
            hiddenCount={hiddenMatches}
            activeIndex={highlighted}
            emptyHint={
              suggestions.all.length === 0 && name.trim() !== ""
                ? `Name “${name.trim()}” not found. You can still join or report it to the host.`
                : null
            }
            onChoose={chooseMember}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="maheId"
          className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500"
        >
          MAHE ID{" "}
          <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>
        </label>
        <div
          className={`field flex items-center gap-2 px-3 py-0 ${matched ? "bg-cream/70" : "focus-within:border-gold"}`}
        >
          <span className="py-3 font-mono text-sm font-semibold text-slate-400 select-none">
            MAHE
          </span>
          <input
            id="maheId"
            name="maheId"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            readOnly={matched !== null}
            role="combobox"
            aria-expanded={showIdList}
            aria-controls="id-suggestions"
            aria-activedescendant={
              showIdList ? activeOptionId("id-suggestions") : undefined
            }
            value={idValue}
            onChange={(event) => {
              setIdValue(idDigits(event.target.value));
              markDirty();
              setHighlighted(0);
              setActiveField("id");
            }}
            onKeyDown={handleListKeyDown}
            onFocus={() => {
              setActiveField(matched ? null : "id");
              setHighlighted(0);
            }}
            onBlur={() => setActiveField(null)}
            placeholder="digits only — leave blank if none"
            className={`min-w-0 flex-1 border-0 bg-transparent py-3 font-mono text-sm outline-none ${
              matched ? "text-slate-500" : "text-navy"
            }`}
          />
          {matched ? (
            <LockIcon className="mr-1 shrink-0 text-slate-400" />
          ) : null}
        </div>
        {matched ? (
          <p className="text-[11px] text-slate-400">
            Locked to your directory entry.
          </p>
        ) : null}
        {showIdList ? (
          <SuggestionList
            id="id-suggestions"
            members={idMatches}
            hiddenCount={hiddenMatches}
            activeIndex={highlighted}
            emptyHint={
              suggestions.all.length === 0 && idValue !== ""
                ? `We don't have a MAHE ID matching ${idValue}. If you have one, check the digits; if you don't (or aren't in the directory), leave this blank and pick your department below.`
                : null
            }
            onChoose={chooseMember}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="department"
          className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500"
        >
          Department
        </label>
        {matched ? (
          <div className="relative">
            <input
              id="department"
              name="department"
              readOnly
              tabIndex={-1}
              value={department}
              className="field cursor-not-allowed border-line bg-cream/70 pr-10 text-slate-500"
            />
            <LockIcon className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
        ) : departments.length > 0 ? (
          <select
            id="department"
            name="department"
            required
            disabled={!departmentUnlocked}
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            className={
              departmentUnlocked
                ? "field focus:field-focus"
                : "field cursor-not-allowed border-line bg-cream/70 text-slate-400"
            }
          >
            <option value="">
              {departmentUnlocked
                ? "Select your department"
                : "Pick your name first"}
            </option>
            {departments.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="department"
            name="department"
            maxLength={120}
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            placeholder="Type your department"
            className="field focus:field-focus"
          />
        )}
        {matched ? (
          <p className="text-[11px] text-slate-400">
            Locked to your directory entry.
          </p>
        ) : !departmentUnlocked ? (
          <p className="text-[11px] text-slate-400">
            Locks until you enter your name above. If your name is not in the
            directory, type it in and the department unlocks for you to pick
            from.
          </p>
        ) : (
          <p className="text-[11px] text-slate-500">
            Not in the list? Pick the department you belong to — you can still
            mark attendance.
          </p>
        )}
        {rosterError ? (
          <p className="text-[11px] text-amber-700">{rosterError}</p>
        ) : null}
      </div>

      {matched ? (
        <div className="rounded-xl border border-line bg-white p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold">
            From the directory
          </p>
          <dl className="mt-2 flex flex-col gap-1.5 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/60 pb-1.5">
              <dt className="text-xs uppercase tracking-[0.1em] text-slate-400">
                MAHE ID
              </dt>
              <dd className="font-mono text-xs font-semibold text-navy">
                {matched.maheId ?? "(not issued yet)"}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/60 pb-1.5">
              <dt className="text-xs uppercase tracking-[0.1em] text-slate-400">
                Name
              </dt>
              <dd className="font-medium text-navy">{matched.name}</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-xs uppercase tracking-[0.1em] text-slate-400">
                Department
              </dt>
              <dd className="text-right text-navy">{matched.department}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] text-slate-400">
            MAHE ID and department are locked to this entry. Change your name to
            edit them.
          </p>
        </div>
      ) : null}

      {requiresLocation ? (
        <p className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-slate-600">
          <span aria-hidden className="text-gold">
            ◎
          </span>
          This meeting verifies you are on site. Allow location access when your
          browser asks.
        </p>
      ) : null}

      {error ? (
        <p
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 outline-none"
        >
          {error}
        </p>
      ) : null}

      {joinReason ? (
        <div className="flex flex-col gap-2 rounded-xl border border-gold/40 bg-gold/5 px-3 py-3">
          <p className="text-xs text-slate-600">
            <span className="font-semibold text-navy">
              Geofence check failed.
            </span>{" "}
            That does not necessarily mean you are in the wrong place — if you
            are at the meeting location, ask the host to let you in. They can
            accept or reject your request.
          </p>
          <button
            type="button"
            onClick={requestToJoin}
            disabled={requesting}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-gold bg-white px-4 py-2 text-sm font-semibold text-gold-dark transition hover:bg-gold hover:text-white disabled:opacity-60"
          >
            {requesting ? "Sending request…" : "Request to join this meeting"}
          </button>
          {requestError ? (
            <p className="text-xs text-red-700">{requestError}</p>
          ) : null}
        </div>
      ) : null}

      {requestSent ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {requestSent}
        </p>
      ) : null}

      {requestDeclined ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          The host rejected your request to join. Please speak to them directly
          if you were at the meeting location.
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

      <div className="rounded-xl border border-line bg-cream/60 p-3">
        <button
          type="button"
          onClick={toggleReport}
          aria-expanded={reportOpen}
          aria-controls="report-panel"
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="text-xs font-semibold text-navy">
            {matched
              ? "These details aren't right?"
              : "Can't find your MAHE ID?"}
          </span>
          <span aria-hidden className="text-sm font-semibold text-gold-dark">
            {reportOpen ? "−" : "+"}
          </span>
        </button>

        {reportOpen ? (
          <div id="report-panel" className="mt-3 flex flex-col gap-3">
            <p className="text-[11px] text-slate-500">
              Send a report to the host for this meeting. It also appears in the
              reports inbox, where the directory owner can act on it.
            </p>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="report-reason"
                className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400"
              >
                What&apos;s wrong?
              </label>
              <select
                id="report-reason"
                value={reportReason}
                onChange={(event) =>
                  setReportReason(event.target.value as ReportReason)
                }
                className="field focus:field-focus py-2"
              >
                {REPORT_REASONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="report-note"
                className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400"
              >
                Details for the host{" "}
                <span className="font-normal normal-case tracking-normal text-slate-400">
                  (optional)
                </span>
              </label>
              <textarea
                id="report-note"
                rows={3}
                maxLength={FACULTY_NOTE_MAX_LENGTH}
                value={reportNote}
                onChange={(event) => setReportNote(event.target.value)}
                placeholder="e.g. I joined this year and my MAHE ID has not been issued yet."
                className="field focus:field-focus resize-y py-2 text-sm"
              />
              <p className="text-right text-[10px] text-slate-400">
                {reportNote.length}/{FACULTY_NOTE_MAX_LENGTH}
              </p>
            </div>
            <button
              type="button"
              onClick={sendReport}
              disabled={reportSending}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-navy bg-white px-4 py-2 text-sm font-semibold text-navy transition hover:bg-navy hover:text-white disabled:opacity-60"
            >
              {reportSending ? "Sending…" : "Send report to host"}
            </button>
            {reportError ? (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                {reportError}
              </p>
            ) : null}
          </div>
        ) : null}

        {reportMessage ? (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {reportMessage}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 ${className ?? ""}`}
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function SuggestionList({
  id,
  members,
  hiddenCount,
  activeIndex,
  emptyHint,
  onChoose,
}: {
  id: string;
  members: FacultyMember[];
  hiddenCount: number;
  activeIndex: number;
  emptyHint: string | null;
  onChoose: (member: FacultyMember) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (members.length === 0) {
    if (!emptyHint) return null;
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {emptyHint}
      </p>
    );
  }

  const optionId = (index: number) => `${id}-option-${index}`;

  return (
    <div className="rounded-xl border border-line bg-white shadow-sm">
      <ul
        id={id}
        role="listbox"
        ref={listRef}
        className="max-h-64 overflow-auto p-1"
      >
        {members.map((member, index) => (
          <li key={`${member.name}-${member.maheId ?? "none"}`}>
            <button
              type="button"
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              data-index={index}
              // Keeps focus in the input so blur does not swallow the click.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChoose(member)}
              className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition ${
                index === activeIndex ? "bg-cream" : "hover:bg-cream"
              }`}
            >
              <span className="text-sm font-medium text-navy">
                {member.name}
                <span className="ml-2 font-mono text-[11px] text-gold-dark">
                  {member.maheId ?? "no ID yet"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-slate-400">
          {hiddenCount} more match — keep typing to narrow the list.
        </p>
      ) : null}
    </div>
  );
}
