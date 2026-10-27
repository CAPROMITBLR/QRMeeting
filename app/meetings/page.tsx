import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/Brand";
import { SavedMeetings } from "@/components/SavedMeetings";

export const metadata: Metadata = {
  title: "Your meetings · Meeting Attendance",
  description: "The host links this browser has saved.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <div className="bg-dot flex min-h-screen flex-col">
      <div className="h-1 w-full bg-gradient-to-r from-gold to-navy" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-8 sm:px-5 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Brand subtitle="Your meetings" />
          <div className="flex items-center gap-2">
            <Link
              href="/reports"
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-gold hover:text-gold"
            >
              Directory reports
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-gold hover:text-gold"
            >
              ← Create a meeting
            </Link>
          </div>
        </div>

        <SavedMeetings />

        <p className="text-xs text-slate-500">
          There is no sign-in: a meeting is opened with the host link it gave you. Save that link (bookmark it, or
          message it to yourself) to open the meeting from another device.
        </p>
      </main>
    </div>
  );
}
