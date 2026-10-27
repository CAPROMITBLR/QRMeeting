import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/Brand";
import { ReportsInbox, type InboxReport } from "@/components/ReportsInbox";
import { sql } from "@/lib/db";

export const metadata: Metadata = {
  title: "Directory reports · Meeting Attendance",
  description: "Open reports about missing or wrong faculty directory entries.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type ReportRow = {
  id: string;
  meeting_id: string | null;
  meeting_title: string | null;
  meeting_starts_at: Date | null;
  mahe_id: string | null;
  name: string | null;
  department: string | null;
  reason: string;
  note: string | null;
  created_at: Date;
};

export default async function Page() {
  let reports: InboxReport[] = [];
  let failure: string | null = null;

  try {
    const rows = await sql<ReportRow[]>`
      select
        reports.id,
        reports.meeting_id,
        meetings.title as meeting_title,
        meetings.starts_at as meeting_starts_at,
        reports.mahe_id,
        reports.name,
        reports.department,
        reports.reason,
        reports.note,
        reports.created_at
      from public.faculty_reports as reports
      left join public.meetings as meetings on meetings.id = reports.meeting_id
      where reports.status = 'open'
      order by reports.created_at asc
      limit 500
    `;
    reports = rows.map((row) => ({
      id: row.id,
      meetingId: row.meeting_id,
      meetingTitle: row.meeting_title,
      meetingStartsAt: row.meeting_starts_at
        ? row.meeting_starts_at.toISOString()
        : null,
      maheId: row.mahe_id,
      name: row.name,
      department: row.department,
      reason: row.reason,
      note: row.note,
      createdAt: row.created_at.toISOString(),
    }));
  } catch (error) {
    console.error("reports inbox page failed", error);
    failure = "Could not load reports right now. Refresh to try again.";
  }

  return (
    <div className="bg-dot flex min-h-screen flex-col">
      <div className="h-1 w-full bg-gradient-to-r from-gold to-navy" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 sm:px-5 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Brand subtitle="Directory reports" />
          <Link
            href="/"
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-gold hover:text-gold"
          >
            ← Create a meeting
          </Link>
        </div>

        <div>
          <h1 className="font-serif text-2xl font-bold text-navy">
            Reports inbox
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Every open report from the attend form, oldest first. A report
            arrives here from a meeting link, and it also sits on that
            meeting&apos;s host page — resolving it in either place clears both.
          </p>
        </div>

        {failure ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {failure}
          </p>
        ) : (
          <ReportsInbox initial={reports} />
        )}
      </main>
    </div>
  );
}
