import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AttendForm } from "@/components/AttendForm";
import { Brand } from "@/components/Brand";
import { formatDateTime } from "@/lib/format";
import { getPublicMeeting } from "@/lib/meetings";
import { meetingWindowState } from "@/lib/time-window";

export async function generateMetadata({ params }: PageProps<"/attend/[id]">): Promise<Metadata> {
  const { id } = await params;
  const meeting = await getPublicMeeting(id);
  return {
    title: meeting ? `Attendance · ${meeting.title}` : "Meeting not found",
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params }: PageProps<"/attend/[id]">) {
  const { id } = await params;
  if (!id) notFound();

  const meeting = await getPublicMeeting(id);
  if (!meeting) notFound();

  return (
    <div className="bg-dot flex min-h-screen flex-col">
      <div className="h-1 w-full bg-gradient-to-r from-gold to-navy" />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 px-4 py-8 sm:gap-6 sm:px-5 sm:py-10">
        <Brand subtitle="Attendance" />

        <div className="card overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-gold to-navy" />
          <div className="flex flex-col gap-5 p-5 sm:p-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold">
                Marking attendance for
              </p>
              <h1 className="mt-1 font-serif text-2xl font-bold leading-snug text-navy">{meeting.title}</h1>
              <p className="mt-1 text-sm text-slate-500">{formatDateTime(meeting.starts_at)} IST</p>
            </div>

            {meetingWindowState(new Date(), meeting.starts_at, meeting.is_open, meeting.closes_at) === "open" ? (
              <AttendForm
                meetingId={meeting.id}
                title={meeting.title}
                requiresLocation={meeting.lat !== null && meeting.lng !== null}
                meetingLatitude={meeting.lat}
                meetingLongitude={meeting.lng}
                meetingRadius={meeting.radius_m}
              />
            ) : (
              <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
                <p className="text-sm font-semibold text-amber-800">Attendance is closed</p>
                <p className="text-xs text-amber-700">
                  The host has closed attendance for this meeting. Ask them to reopen it if you still need to
                  mark.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
