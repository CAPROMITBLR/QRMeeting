"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import { forgetMeeting, meetingHref, readSavedMeetings, type SavedMeeting } from "@/lib/saved-meetings";

function savedLabel(savedAt: string): string {
  if (!savedAt) return "";
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function SavedMeetings() {
  const [meetings, setMeetings] = useState<SavedMeeting[] | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOrigin(window.location.origin);
      setMeetings(readSavedMeetings());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function remove(meeting: SavedMeeting) {
    forgetMeeting(meeting.id);
    setMeetings(readSavedMeetings());
  }

  if (meetings === null) {
    return (
      <section className="card p-5">
        <p className="text-xs text-slate-400">Looking for meetings saved in this browser…</p>
      </section>
    );
  }

  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-serif text-lg font-bold text-navy">Your meetings</h2>
          <p className="text-xs text-slate-500">
            Host links saved in this browser. There are no accounts — keep the link itself and you can open the
            meeting anywhere.
          </p>
        </div>
      </div>

      {meetings.length === 0 ? (
        <p className="rounded-lg border border-line bg-cream/60 px-3 py-2 text-xs text-slate-500">
          Nothing saved here yet. Create a meeting and its host link is added automatically.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line/70">
          {meetings.map((meeting) => (
            <li key={meeting.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <Link
                  href={meetingHref(meeting)}
                  className="block truncate text-sm font-semibold text-navy transition hover:text-gold"
                >
                  {meeting.title}
                </Link>
                <p className="font-mono text-[11px] text-slate-400">
                  {meeting.id.slice(0, 8)}…
                  {savedLabel(meeting.savedAt) ? <span className="ml-2">saved {savedLabel(meeting.savedAt)}</span> : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <CopyButton value={`${origin}${meetingHref(meeting)}`} label="Copy host link" />
                <button
                  type="button"
                  onClick={() => remove(meeting)}
                  className="min-h-10 rounded-lg px-3 py-2 text-xs font-semibold text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                >
                  Forget
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-slate-400">
        &ldquo;Forget&rdquo; only clears this list — the meeting and its attendance stay in the database, and the link
        keeps working for anyone who has it.
      </p>
    </section>
  );
}
