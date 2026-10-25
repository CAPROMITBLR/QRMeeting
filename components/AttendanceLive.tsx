"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ATTENDANCE_POLL_MS, ATTENDANCE_RECONCILE_MS } from "@/lib/config";
import { formatClock, formatTime } from "@/lib/format";
import type { RealtimeConfig } from "@/lib/realtime";
import { subscribeToMeetingChange, type HostConnectionState } from "@/lib/realtime-client";
import { istDateTimeInput, parseIstDateTime } from "@/lib/timezone";

export type Attendee = {
  id: string;
  name: string;
  collegeId: string | null;
  department: string | null;
  markedAt: string;
  distanceM: number | null;
  manualApproval?: boolean;
};

/** A geofence failure the host can approve or reject. */
export type JoinRequest = {
  id: string;
  name: string;
  collegeId: string | null;
  department: string | null;
  distanceM: number | null;
  accuracyM: number | null;
  reason: string;
  createdAt: string;
};

type Snapshot = {
  isOpen: boolean;
  autoClosed: boolean;
  closesAt: string | null;
  count: number;
  attendees: Attendee[];
  requests: JoinRequest[];
};

function describeRequest(request: JoinRequest): string {
  const parts: string[] = [];
  if (typeof request.distanceM === "number") parts.push(`${Math.round(request.distanceM)} m from the venue`);
  if (request.reason === "location_inaccurate" && typeof request.accuracyM === "number") {
    parts.push(`GPS accuracy ±${Math.round(request.accuracyM)} m`);
  } else if (request.reason === "location_required") {
    parts.push("location not shared");
  }
  if (request.department) parts.push(request.department);
  parts.push(formatTime(request.createdAt));
  return parts.join(" · ");
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function AttendanceLive({
  meetingId,
  hostKey,
  initial,
  realtime,
}: {
  meetingId: string;
  hostKey: string;
  initial: Snapshot;
  realtime: RealtimeConfig | null;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [editingAutoClose, setEditingAutoClose] = useState(false);
  const [autoCloseDraft, setAutoCloseDraft] = useState("");
  const [connection, setConnection] = useState<HostConnectionState>(realtime ? "connecting" : "offline");
  const refreshInFlightRef = useRef(false);
  const refreshSoonRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(
        `/api/meetings/${meetingId}/attendance?key=${encodeURIComponent(hostKey)}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) {
        setError("Could not refresh attendance.");
        return;
      }
      const data = (await response.json()) as Snapshot;
      setSnapshot(data);
      setError(null);
      setRefreshedAt(Date.now());
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      setError("Connection lost — retrying…");
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [meetingId, hostKey]);

  // Collapse bursts (a host approving five requests) into one refetch.
  const refreshSoon = useCallback(() => {
    if (refreshSoonRef.current !== null) return;
    refreshSoonRef.current = window.setTimeout(() => {
      refreshSoonRef.current = null;
      void refresh();
    }, 150);
  }, [refresh]);

  useEffect(() => {
    if (!realtime) return;
    return subscribeToMeetingChange({
      url: realtime.url,
      key: realtime.key,
      meetingId,
      onChange: refreshSoon,
      onState: (state) => {
        setConnection(state);
        // Pick up anything that changed while the socket was connecting.
        if (state === "live") refreshSoon();
      },
    });
  }, [meetingId, realtime, refreshSoon]);

  useEffect(() => {
    // Realtime pushes changes; this timer reconciles, and carries the page on
    // its own when the socket is unavailable.
    const intervalMs = connection === "live" ? ATTENDANCE_RECONCILE_MS : ATTENDANCE_POLL_MS;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      abortRef.current?.abort();
      if (refreshSoonRef.current !== null) {
        window.clearTimeout(refreshSoonRef.current);
        refreshSoonRef.current = null;
      }
    };
  }, [refresh, connection]);

  const closesAtMs = snapshot.closesAt ? Date.parse(snapshot.closesAt) : null;
  // The server flag covers first paint; the tick flips the UI the moment the deadline passes.
  const autoClosed = snapshot.autoClosed || (closesAtMs !== null && now !== null && now >= closesAtMs);
  const isOpen = snapshot.isOpen && !autoClosed;

  async function patchMeeting(body: { is_open?: boolean; closes_at?: string | null }) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${meetingId}?key=${encodeURIComponent(hostKey)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { isOpen?: boolean; closesAt?: string | null; message?: string };
      if (!response.ok) {
        setError(data.message ?? "Could not update the meeting.");
        return false;
      }
      setSnapshot((current) => {
        const closesAt = data.closesAt === undefined ? current.closesAt : data.closesAt;
        return {
          ...current,
          isOpen: typeof data.isOpen === "boolean" ? data.isOpen : current.isOpen,
          closesAt,
          autoClosed: closesAt !== null && Date.parse(closesAt) <= Date.now(),
        };
      });
      return true;
    } catch {
      setError("Network error. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggleOpen() {
    if (autoClosed) {
      // A passed auto-close would keep attendance shut; clear it while reopening.
      await patchMeeting({ is_open: true, closes_at: null });
      return;
    }
    await patchMeeting({ is_open: !snapshot.isOpen });
  }

  async function saveAutoClose() {
    const parsed = parseIstDateTime(autoCloseDraft);
    if (!parsed) {
      setError("Pick a date and time first.");
      return;
    }
    if (await patchMeeting({ closes_at: parsed.toISOString() })) setEditingAutoClose(false);
  }

  async function decideRequest(request: JoinRequest, action: "approve" | "reject") {
    setDecidingId(request.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/meetings/${meetingId}/join-requests/${request.id}?key=${encodeURIComponent(hostKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const data = (await response.json()) as { status?: string; message?: string };
      if (!response.ok) {
        setError(data.message ?? "Could not update this request.");
        return;
      }

      setSnapshot((current) => ({
        ...current,
        requests: current.requests.filter((item) => item.id !== request.id),
      }));
      if (action === "approve") await refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setDecidingId(null);
    }
  }

  async function removeAttendee(attendee: Attendee) {
    if (!window.confirm(`Remove ${attendee.name} from this meeting's attendance?`)) return;

    setDeletingId(attendee.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/meetings/${meetingId}/attendance/${attendee.id}?key=${encodeURIComponent(hostKey)}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(data.message ?? "Could not remove the entry.");
        return;
      }

      setSnapshot((current) => ({
        ...current,
        count: Math.max(0, current.count - 1),
        attendees: current.attendees.filter((item) => item.id !== attendee.id),
      }));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="card flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-center gap-3">
          <h2 className="font-serif text-lg font-bold text-navy">Attendees</h2>
          <span className="inline-flex items-baseline gap-1 rounded-full bg-cream px-2.5 py-1 text-xs font-semibold text-gold">
            <span className="text-base leading-none">{snapshot.count}</span>
            marked
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            <span className={`h-1.5 w-1.5 rounded-full ${isOpen ? "animate-pulse bg-emerald-500" : "bg-slate-400"}`} />
            {isOpen ? "Live" : autoClosed ? "Auto-closed" : "Closed"}
          </span>
          <button
            type="button"
            onClick={toggleOpen}
            disabled={busy}
            className={`min-h-12 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:opacity-60 ${
              isOpen
                ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
            }`}
          >
            {busy ? "Saving…" : isOpen ? "Close attendance" : autoClosed ? "Reopen now" : "Open attendance"}
          </button>
        </div>
      </div>

      {snapshot.closesAt ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-cream/60 px-4 py-2 text-xs text-slate-600 sm:px-5">
          <span className="font-semibold text-gold-dark">
            {autoClosed ? "Auto-closed at" : "Auto-closes at"} {formatClock(snapshot.closesAt)}
          </span>
          {autoClosed || now === null || closesAtMs === null ? null : (
            <span className="font-mono text-[11px] text-slate-500">in {countdown(closesAtMs - now)}</span>
          )}
          <button
            type="button"
            onClick={() => {
              setAutoCloseDraft(istDateTimeInput(new Date(snapshot.closesAt!)));
              setEditingAutoClose(true);
            }}
            className="font-semibold text-navy underline-offset-2 hover:text-gold hover:underline"
          >
            Edit
          </button>
        </div>
      ) : null}

      {editingAutoClose ? (
        <div className="flex flex-wrap items-end gap-2 border-b border-line bg-white px-4 py-3 sm:px-5">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Auto-close (IST)
            </span>
            <input
              type="datetime-local"
              value={autoCloseDraft}
              onChange={(event) => setAutoCloseDraft(event.target.value)}
              className="field focus:field-focus py-2"
            />
          </label>
          <button
            type="button"
            onClick={saveAutoClose}
            disabled={busy}
            className="min-h-12 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-navy hover:border-gold hover:text-gold disabled:opacity-60"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => patchMeeting({ closes_at: null }).then(() => setEditingAutoClose(false))}
            disabled={busy}
            className="min-h-12 rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:text-red-600 disabled:opacity-60"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setEditingAutoClose(false)}
            className="min-h-12 rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:text-navy"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {snapshot.requests.length > 0 ? (
        <section className="border-b border-gold/30 bg-gold/5 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-dark">
              Join requests ({snapshot.requests.length})
            </h3>
            <span className="text-[11px] text-slate-500">
              Geofence not met — approve only if you can see them
            </span>
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {snapshot.requests.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-navy">
                    {request.name}
                    {request.collegeId ? (
                      <span className="ml-2 text-xs font-normal text-slate-400">{request.collegeId}</span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-slate-500">{describeRequest(request)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => decideRequest(request, "approve")}
                    disabled={decidingId === request.id}
                    className="min-h-10 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {decidingId === request.id ? "Saving…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => decideRequest(request, "reject")}
                    disabled={decidingId === request.id}
                    className="min-h-10 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="min-h-[16rem] flex-1 overflow-auto">
        {snapshot.attendees.length === 0 ? (
          <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-cream text-gold">⌛</span>
            <p className="text-sm font-medium text-slate-500">Waiting for the first attendee…</p>
            <p className="text-xs text-slate-400">The list updates every 3 seconds.</p>
          </div>
        ) : (
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="sticky top-0 bg-white/95 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                <th className="px-4 py-2 font-semibold sm:px-5">#</th>
                <th className="px-2 py-2 font-semibold">Name</th>
                <th className="px-2 py-2 font-semibold">College ID</th>
                <th className="px-2 py-2 font-semibold">Department</th>
                <th className="px-2 py-2 font-semibold">Distance</th>
                <th className="px-2 py-2 text-right font-semibold">Time</th>
                <th className="px-4 py-2 sm:px-5">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {snapshot.attendees.map((attendee, index) => (
                <tr key={attendee.id} className="border-t border-line/70">
                  <td className="px-4 py-2.5 text-xs text-slate-400 sm:px-5">{index + 1}</td>
                  <td className="px-2 py-2.5 font-medium text-navy">
                    {attendee.name}
                    {attendee.manualApproval ? (
                      <span className="ml-1.5 rounded bg-gold/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gold-dark">
                        approved
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5 text-xs text-slate-500">{attendee.collegeId ?? "—"}</td>
                  <td className="px-2 py-2.5 text-xs text-slate-500">{attendee.department ?? "—"}</td>
                  <td className="px-2 py-2.5 text-xs text-slate-500">
                    {attendee.distanceM === null ? "—" : `${Math.round(attendee.distanceM)} m`}
                  </td>
                  <td className="px-2 py-2.5 text-right text-xs text-slate-500">
                    {formatTime(attendee.markedAt)}
                  </td>
                  <td className="px-4 py-2.5 text-right sm:px-5">
                    <button
                      type="button"
                      onClick={() => removeAttendee(attendee)}
                      disabled={deletingId === attendee.id}
                      title={`Remove ${attendee.name}`}
                      className="min-h-12 min-w-12 rounded-lg px-2 text-xs font-semibold text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      {deletingId === attendee.id ? "…" : "✕"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:px-5">
        <p className="text-[11px] text-slate-400">
          {connection === "live"
            ? `Live · updated ${refreshedAt ? formatTime(refreshedAt) : "just now"}`
            : refreshedAt
              ? `Updated ${formatTime(refreshedAt)} · checking every ${ATTENDANCE_POLL_MS / 1000} s`
              : `Checking every ${ATTENDANCE_POLL_MS / 1000} s`}
          {snapshot.closesAt
            ? autoClosed
              ? " · auto-close passed"
              : " · closes automatically"
            : " · closes only when you close it"}
        </p>
      </div>
    </section>
  );
}
