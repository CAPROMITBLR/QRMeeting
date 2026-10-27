"use client";

import { useCallback, useEffect, useState } from "react";

import { formatDateTime } from "@/lib/format";

export type InboxReport = {
  id: string;
  meetingId: string | null;
  meetingTitle: string | null;
  meetingStartsAt: string | null;
  maheId: string | null;
  name: string | null;
  department: string | null;
  reason: string;
  note: string | null;
  createdAt: string;
};

const REASON_LABELS: Record<string, string> = {
  id_missing: "MAHE ID not in the directory",
  details_incorrect: "Name or department is wrong",
  other: "Something else",
};

export function ReportsInbox({ initial }: { initial: InboxReport[] }) {
  const [reports, setReports] = useState<InboxReport[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/faculty/reports", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { reports?: InboxReport[] };
      setReports(Array.isArray(data.reports) ? data.reports : []);
      setRefreshedAt(Date.now());
    } catch {
      // Keep the last snapshot; the page still works without a refresh.
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function resolve(report: InboxReport) {
    setBusyId(report.id);
    setError(null);
    try {
      const response = await fetch(`/api/faculty/reports/${report.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resolve" }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(data.message ?? "Could not update this report.");
        return;
      }
      setReports((current) => current.filter((item) => item.id !== report.id));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (reports.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 p-8 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-cream text-gold">✓</span>
        <p className="text-sm font-semibold text-slate-600">No open reports</p>
        <p className="text-xs text-slate-400">
          When an attendee reports a missing or wrong MAHE ID, it shows up here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <ul className="card flex flex-col divide-y divide-line/70">
        {reports.map((report) => (
          <li key={report.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-navy">
                {report.name ?? "Name not given"}
                {report.maheId ? (
                  <span className="ml-2 font-mono text-xs font-normal text-slate-500">{report.maheId}</span>
                ) : (
                  <span className="ml-2 text-xs font-normal text-slate-400">no MAHE ID</span>
                )}
              </p>
              <p className="text-[11px] text-slate-500">
                {REASON_LABELS[report.reason] ?? report.reason}
                {report.department ? ` · ${report.department}` : ""} · {formatDateTime(report.createdAt)}
              </p>
              {report.note ? (
                <p className="mt-1 whitespace-pre-wrap border-l-2 border-gold/40 pl-2 text-[11px] italic text-slate-600">
                  {report.note}
                </p>
              ) : null}
              <p className="mt-1 text-[11px] text-slate-400">
                {report.meetingId ? (
                  <>
                    {report.meetingTitle ?? "Meeting"}
                    {report.meetingStartsAt ? ` · ${formatDateTime(report.meetingStartsAt)} IST` : ""}
                  </>
                ) : (
                  "Meeting deleted"
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => resolve(report)}
              disabled={busyId === report.id}
              className="min-h-10 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-navy transition hover:border-gold hover:text-gold disabled:opacity-60"
            >
              {busyId === report.id ? "Saving…" : "Resolve"}
            </button>
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-slate-400">
        {refreshedAt ? `Updated ${formatDateTime(new Date(refreshedAt).toISOString())}` : "Refreshing every 10 seconds"}
      </p>
    </div>
  );
}
