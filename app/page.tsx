import type { Metadata } from "next";

import { Brand } from "@/components/Brand";
import { CreateMeetingForm } from "@/components/CreateMeetingForm";
import { HostLinkHistory } from "@/components/HostLinkHistory";

export const metadata: Metadata = {
  title: "Create a meeting · Meeting Attendance",
  description: "Create a meeting, print the QR code, and watch attendance arrive live.",
};

export default function Home() {
  return (
    <div className="bg-dot flex min-h-screen flex-col">
      <div className="h-1 w-full bg-gradient-to-r from-gold to-navy" />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 px-4 py-8 sm:gap-6 sm:px-5 sm:py-12">
        <Brand />

        <div className="card overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-gold to-navy" />
          <div className="flex flex-col gap-5 p-6">
            <div>
              <h1 className="font-serif text-2xl font-bold text-navy">Create a meeting</h1>
              <p className="mt-1 text-sm text-slate-500">
                Generate a QR code for the room. Attendees scan it, enter their name, and appear in your list
                instantly.
              </p>
            </div>
            <CreateMeetingForm />
          </div>
        </div>

        <HostLinkHistory />

        <ol className="grid gap-2 text-xs text-slate-500">
          {[
            "Create the meeting and bookmark the host link it gives you.",
            "Download the QR and display or print it for the room.",
            "Watch names arrive live; close attendance when the meeting ends.",
          ].map((step, index) => (
            <li key={step} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold/10 text-[11px] font-bold text-gold">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </main>

      <footer className="pb-6 text-center text-[10px] uppercase tracking-[0.14em] text-slate-400">
        Faculty meeting attendance
      </footer>
    </div>
  );
}
