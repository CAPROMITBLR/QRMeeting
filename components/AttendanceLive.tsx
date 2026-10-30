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

/** An attendee saying their MAHE ID is missing, or the details against it are wrong. */
export type FacultyReport = {
  id: string;
  maheId: string | null;
  name: string | null;
  department: string | null;
  reason: string;
  note: string | null;
  createdAt: string;
};

type Snapshot = {
  isOpen: boolean;
  autoClosed: boolean;
  closesAt: string | null;
  endedAt: string | null;
  reportSentAt: string | null;
  count: number;
  attendees: Attendee[];
  requests: JoinRequest[];
  reports: FacultyReport[];
};

const REPORT_LABELS: Record<string, string> = {
  id_missing: "MAHE ID not in the directory",
  details_incorrect: "Name or department is wrong",
  other: "Something else",
};

function describeReport(report: FacultyReport): string {
  const parts = [REPORT_LABELS[report.reason] ?? report.reason];
  if (report.department) parts.push(report.department);
  parts.push(formatTime(report.createdAt));
  return parts.join(" · ");
}

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
  defaultReportEmail,
}: {
  meetingId: string;
  hostKey: string;
  initial: Snapshot;
  realtime: RealtimeConfig | null;
  defaultReportEmail: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [editingAutoClose, setEditingAutoClose] = useState(false);
  const [autoCloseDraft, setAutoCloseDraft] = useState("");
  const [connection, setConnection] = useState<HostConnectionState>(realtime ? "connecting" : "offline");
  const [reportEmail, setReportEmail] = useState(defaultReportEmail);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportStatus, setReportStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const refreshInFlightRef = useRef(false);
  const refreshSoonRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Bumped on every local change; a poll that started before the change is
  // discarded so it cannot overwrite the newer state (the "click twice" bug).
  const mutationRef = useRef(0);

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
    const token = mutationRef.current;
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
      // A local change landed while this poll was in flight: its snapshot is
      // older than what we already applied, so drop it.
      if (mutationRef.current !== token) return;
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
  const meetingEnded = snapshot.endedAt !== null;

  async function patchMeeting(body: { is_open?: boolean; closes_at?: string | null }) {
    setBusy(true);
    setError(null);
    abortRef.current?.abort();
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
      mutationRef.current += 1;
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

      mutationRef.current += 1;
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

  async function endAndEmailReport() {
    const recipients = reportEmail.trim();
    if (recipients === "") {
      setReportStatus({ ok: false, text: "Add at least one email address first." });
      return;
    }
    setReportBusy(true);
    setReportStatus(null);
    setError(null);
    try {
      const response = await fetch(
        `/api/meetings/${meetingId}/end?key=${encodeURIComponent(hostKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: recipients }),
        },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        endedAt?: string | null;
        reportSentAt?: string | null;
        recipients?: string[];
        message?: string;
      };

      mutationRef.current += 1;
      // The meeting ends before the email is attempted, so reflect that
      // immediately (full state arrives on the next poll).
      setSnapshot((current) => ({
        ...current,
        isOpen: false,
        endedAt: data.endedAt ?? new Date().toISOString(),
        reportSentAt: data.reportSentAt ?? null,
      }));

      if (!response.ok || data.ok !== true) {
        setReportStatus({
          ok: false,
          text: data.message ?? "Could not email the report — the meeting is ended, so try “Resend report”.",
        });
        void refresh();
        return;
      }

      setReportStatus({
        ok: true,
        text: `Report sent to ${(data.recipients ?? []).join(", ")}.`,
      });
      void refreshSoon();
    } catch {
      setReportStatus({
        ok: false,
        text: "Network error — the send may have gone through. Try “Resend report” after a moment.",
      });
      void refreshSoon();
    } finally {
      setReportBusy(false);
    }
  }

  async function resolveReport(report: FacultyReport) {
    setResolvingId(report.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/meetings/${meetingId}/faculty-reports/${report.id}?key=${encodeURIComponent(hostKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "resolve" }),
        },
      );
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(data.message ?? "Could not update this report.");
        return;
      }

      mutationRef.current += 1;
      setSnapshot((current) => ({
        ...current,
        reports: current.reports.filter((item) => item.id !== report.id),
      }));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setResolvingId(null);
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

      {snapshot.reports.length > 0 ? (
        <section className="border-b border-amber-200 bg-amber-50/70 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">
              Directory reports ({snapshot.reports.length})
            </h3>
            <span className="text-[11px] text-amber-700">
              Someone could not find their MAHE ID — add or fix it, then resolve
              <a
                href="/reports"
                className="ml-1.5 font-semibold text-navy underline underline-offset-2 hover:text-gold"
              >
                inbox
              </a>
            </span>
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {snapshot.reports.map((report) => (
              <li
                key={report.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-navy">
                    {report.name ?? "Name not given"}
                    {report.maheId ? (
                      <span className="ml-2 font-mono text-xs font-normal text-slate-500">{report.maheId}</span>
                    ) : (
                      <span className="ml-2 text-xs font-normal text-slate-400">no MAHE ID</span>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-500">{describeReport(report)}</p>
                  {report.note ? (
                    <p className="mt-1 whitespace-pre-wrap border-l-2 border-gold/40 pl-2 text-[11px] italic text-slate-600">
                      {report.note}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => resolveReport(report)}
                  disabled={resolvingId === report.id}
                  className="min-h-10 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-navy transition hover:border-gold hover:text-gold disabled:opacity-60"
                >
                  {resolvingId === report.id ? "Saving…" : "Resolve"}
                </button>
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
            <p className="text-xs text-slate-400">Attendees appear here as they mark attendance.</p>
          </div>
        ) : (
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="sticky top-0 bg-white/95 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                <th className="px-4 py-2 font-semibold sm:px-5">#</th>
                <th className="px-2 py-2 font-semibold">Name</th>
                <th className="px-2 py-2 font-semibold">MAHE ID</th>
                <th className="px-2 py-2 font-semibold">Department</th>
                <th className="px-4 py-2 text-right font-semibold sm:px-5">Time</th>
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
                  <td className="px-4 py-2.5 text-right text-xs text-slate-500 sm:px-5">
                    {formatTime(attendee.markedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {meetingEnded
                ? `Report email${snapshot.reportSentAt ? ` · sent ${formatTime(snapshot.reportSentAt)}` : " · not sent yet"}`
                : "End meeting & email report to"}
            </span>
            <input
              type="email"
              multiple
              value={reportEmail}
              onChange={(event) => {
                setReportEmail(event.target.value);
                setReportStatus(null);
              }}
              placeholder="you@gmail.com, someone@gmail.com"
              className="field focus:field-focus py-2"
              autoComplete="email"
            />
          </label>
          <button
            type="button"
            onClick={endAndEmailReport}
            disabled={reportBusy || reportEmail.trim() === ""}
            className="min-h-12 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white transition hover:bg-navy/90 disabled:opacity-60"
          >
            {reportBusy ? "Working…" : meetingEnded ? "Resend report" : "End meeting & email report"}
          </button>
        </div>
        {reportStatus ? (
          <p
            role="status"
            className={`text-xs ${reportStatus.ok ? "text-emerald-700" : "text-red-700"}`}
          >
            {reportStatus.text}
          </p>
        ) : null}
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
