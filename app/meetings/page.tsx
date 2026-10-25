import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/Brand";
import { ClaimLegacyMeetings } from "@/components/ClaimLegacyMeetings";
import { HostAuthPanel } from "@/components/HostAuthPanel";
import { RemoveMeetingButton, SignOutButton } from "@/components/HostAccountButtons";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getHost } from "@/lib/host-session";

export const metadata: Metadata = {
  title: "Your meetings · Meeting Attendance",
  description: "Every meeting saved to your host account, on any device.",
  robots: { index: false, follow: false },
};

type MeetingRow = {
  id: string;
  title: string;
  host_token: string;
  starts_at: Date;
  is_open: boolean;
  closes_at: Date | null;
  auto_closed: boolean;
  attendee_count: number;
};

export default async function Page() {
  const host = await getHost();

  return (
    <div className="bg-dot flex min-h-screen flex-col">
      <div className="h-1 w-full bg-gradient-to-r from-gold to-navy" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-8 sm:px-5 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Brand subtitle="Host account" />
          <Link
            href="/"
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-gold hover:text-gold"
          >
            ← Create a meeting
          </Link>
        </div>

        {host ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h1 className="font-serif text-2xl font-bold text-navy">Your meetings</h1>
                <p className="mt-1 text-sm text-slate-500">
                  Signed in as <span className="font-semibold text-navy">{host.name}</span> · stored in the database,
                  available from any device
                </p>
              </div>
              <SignOutButton />
            </div>

            <ClaimLegacyMeetings />
            <MeetingsList hostId={host.id} />
          </>
        ) : (
          <div className="card flex flex-col gap-5 p-6">
            <div>
              <h1 className="font-serif text-2xl font-bold text-navy">Your meetings</h1>
              <p className="mt-1 text-sm text-slate-500">
                Sign in to see every meeting you created — on this phone, a laptop, or any other device.
              </p>
            </div>
            <HostAuthPanel />
          </div>
        )}
      </main>
    </div>
  );
}

async function MeetingsList({ hostId }: { hostId: string }) {
  let meetings: MeetingRow[] = [];
  let failure: string | null = null;

  try {
    meetings = await sql<MeetingRow[]>`
      select
        meetings.id,
        meetings.title,
        meetings.host_token,
        meetings.starts_at,
        meetings.is_open,
        meetings.closes_at,
        (meetings.closes_at is not null and meetings.closes_at <= now()) as auto_closed,
        (select count(*)::int from public.attendance where attendance.meeting_id = meetings.id) as attendee_count
      from public.meetings
      where meetings.host_id = ${hostId}
      order by meetings.created_at desc
      limit 100
    `;
  } catch (error) {
    console.error("load host meetings failed", error);
    failure = "Could not load your meetings right now. Refresh to try again.";
  }

  if (failure) {
    return <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{failure}</p>;
  }

  if (meetings.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 p-8 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-cream text-gold">⌛</span>
        <p className="text-sm font-semibold text-slate-600">No meetings yet</p>
        <p className="text-xs text-slate-400">Create one and it will show up here on every device you sign in on.</p>
        <Link
          href="/"
          className="mt-2 inline-flex min-h-11 items-center rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-white transition hover:bg-gold-dark"
        >
          Create a meeting
        </Link>
      </div>
    );
  }

  return (
    <ul className="card flex flex-col divide-y divide-line/70">
      {meetings.map((meeting) => {
        const closed = !meeting.is_open || meeting.auto_closed;
        return (
          <li key={meeting.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <Link
                href={`/meetings/${meeting.id}?key=${encodeURIComponent(meeting.host_token)}`}
                className="block truncate text-sm font-semibold text-navy hover:text-gold"
              >
                {meeting.title}
              </Link>
              <p className="text-xs text-slate-400">
                {formatDateTime(meeting.starts_at)} IST
                <span className="mx-1.5 text-slate-300">·</span>
                {meeting.attendee_count} marked
                <span className="mx-1.5 text-slate-300">·</span>
                <span className={closed ? "text-amber-700" : "text-emerald-700"}>
                  {meeting.auto_closed ? "Auto-closed" : closed ? "Closed" : "Open"}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/meetings/${meeting.id}?key=${encodeURIComponent(meeting.host_token)}`}
                className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 py-2 text-xs font-semibold text-navy transition hover:border-gold hover:text-gold"
              >
                Open
              </Link>
              <RemoveMeetingButton meetingId={meeting.id} title={meeting.title} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
