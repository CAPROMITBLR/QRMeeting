import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { AttendanceLive, type Attendee } from "@/components/AttendanceLive";
import { Brand } from "@/components/Brand";
import { CopyButton } from "@/components/CopyButton";
import { RememberHostLink } from "@/components/RememberHostLink";
import { QrCountdown } from "@/components/QrCountdown";
import { requestOrigin } from "@/lib/base-url";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { hostKeyMatches } from "@/lib/host-key";
import { attendeeUrl } from "@/lib/qr";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = {
  title: "Host view · Meeting Attendance",
  robots: { index: false, follow: false },
};

type Meeting = {
  id: string;
  title: string;
  host_token: string;
  starts_at: Date;
  is_open: boolean;
  lat: number | null;
  lng: number | null;
  radius_m: number;
  closes_at: Date | null;
  auto_closed: boolean;
};

export default async function Page({ params, searchParams }: PageProps<"/meetings/[id]">) {
  const { id } = await params;
  const { key } = await searchParams;
  const hostKey = typeof key === "string" && key.length <= 200 ? key : null;

  if (!isUuid(id) || !hostKey) return <InvalidHostLink />;

  const [meeting] = await sql<Meeting[]>`
    select
      id, title, host_token, starts_at, is_open, lat, lng, radius_m, closes_at,
      (closes_at is not null and closes_at <= now()) as auto_closed
    from public.meetings
    where id = ${id}
  `;

  if (!meeting || !hostKeyMatches(hostKey, meeting.host_token)) return <InvalidHostLink />;

  const rows = await sql<{
    id: string;
    name: string;
    college_id: string | null;
    department: string | null;
    marked_at: Date;
    distance_m: number | null;
  }[]>`
    select id, name, college_id, department, marked_at, distance_m
    from public.attendance
    where meeting_id = ${id}
    order by marked_at asc
  `;

  const attendees: Attendee[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    collegeId: row.college_id,
    department: row.department,
    markedAt: row.marked_at.toISOString(),
    distanceM: row.distance_m,
  }));

  const origin = await requestOrigin();
  const attendUrl = attendeeUrl(origin, id);
  const hostUrl = `${origin}/meetings/${id}?key=${encodeURIComponent(hostKey)}`;
  const qrSrc = `/api/meetings/${id}/qr.png?key=${encodeURIComponent(hostKey)}`;
  const csvHref = `/api/meetings/${id}/export.csv?key=${encodeURIComponent(hostKey)}`;
  const xlsxHref = `/api/meetings/${id}/export.xlsx?key=${encodeURIComponent(hostKey)}`;
  const geofenced = meeting.lat !== null && meeting.lng !== null;
  const autoClosed = meeting.auto_closed;

  return (
    <div className="bg-dot flex min-h-screen flex-col">
      <div className="h-1 w-full bg-gradient-to-r from-gold to-navy" />
      <RememberHostLink
        id={meeting.id}
        title={meeting.title}
        hostKey={hostKey}
        startsAt={meeting.starts_at.toISOString()}
      />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6 sm:gap-5 sm:px-5 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Brand subtitle="Host view" />
        <Link
          href="/"
          className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-gold hover:text-gold"
        >
          Create another meeting
        </Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-navy sm:text-3xl">{meeting.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatDateTime(meeting.starts_at)} IST
            <span className="mx-2 text-slate-300">·</span>
            <span className="font-mono text-xs text-slate-400">{meeting.id}</span>
          </p>
          {geofenced ? (
            <p className="mt-1 text-xs text-gold-dark">
              Geofence: {meeting.radius_m} m around {meeting.lat!.toFixed(5)}, {meeting.lng!.toFixed(5)}
            </p>
          ) : null}
        </div>
        <a
          href={csvHref}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 py-2 text-xs font-semibold text-navy transition hover:border-gold hover:text-gold sm:w-auto"
        >
          Export CSV
        </a>
        <a
          href={xlsxHref}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 py-2 text-xs font-semibold text-navy transition hover:border-gold hover:text-gold sm:w-auto"
        >
          Export Excel report
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-gold/25 bg-gold/5 px-4 py-3 text-xs text-slate-600">
        <span className="font-semibold text-gold-dark">Bookmark this page.</span>
        <span>Anyone with this host link can see and control attendance — keep it private.</span>
        <CopyButton value={hostUrl} label="Copy host link" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="card flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg font-bold text-navy">QR code</h2>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Print or show</span>
          </div>

          <div className="mx-auto rounded-xl border border-line bg-white p-3">
            <Image
              src={qrSrc}
              alt={`QR code for ${meeting.title}`}
              width={280}
              height={280}
              unoptimized
              className="h-56 w-56 sm:h-64 sm:w-64"
            />
          </div>

          <a
            href={qrSrc}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-navy px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy/90"
          >
            Download QR (PNG)
          </a>
          <QrCountdown closesAt={meeting.closes_at ? meeting.closes_at.toISOString() : null} />

          <div className="rounded-xl border border-line bg-cream px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Attendee link</p>
            <p className="mt-1 break-all font-mono text-[11px] text-slate-600">{attendUrl}</p>
            <div className="mt-2">
              <CopyButton value={attendUrl} label="Copy attendee link" />
            </div>
          </div>
        </section>

        <AttendanceLive
          meetingId={meeting.id}
          hostKey={hostKey}
          initial={{
            isOpen: meeting.is_open && !autoClosed,
            autoClosed,
            closesAt: meeting.closes_at ? meeting.closes_at.toISOString() : null,
            count: attendees.length,
            attendees,
          }}
        />
      </div>
      </main>
    </div>
  );
}

function InvalidHostLink() {
  return (
    <div className="bg-dot flex min-h-screen flex-col">
      <div className="h-1 w-full bg-gradient-to-r from-gold to-navy" />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 px-5 py-10">
        <Brand subtitle="Host view" />
        <div className="card flex flex-col gap-3 p-6">
          <h1 className="font-serif text-xl font-bold text-navy">This host link isn&apos;t valid</h1>
          <p className="text-sm text-slate-500">
            The key in the address is missing or no longer matches this meeting. Use the exact link you were
            given when you created the meeting, including the <span className="font-mono text-xs">?key=…</span>{" "}
            part.
          </p>
          <Link href="/" className="text-sm font-semibold text-gold hover:text-gold-dark">
            ← Create a new meeting
          </Link>
        </div>
      </main>
    </div>
  );
}
