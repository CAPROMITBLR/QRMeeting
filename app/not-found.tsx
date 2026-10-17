import Link from "next/link";

import { Brand } from "@/components/Brand";

export default function NotFound() {
  return (
    <div className="bg-dot flex min-h-screen flex-col">
      <div className="h-1 w-full bg-gradient-to-r from-gold to-navy" />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-5 py-10">
        <Brand subtitle="Attendance" />
        <div className="card flex flex-col gap-3 p-6">
          <h1 className="font-serif text-xl font-bold text-navy">Meeting not found</h1>
          <p className="text-sm text-slate-500">
            This QR code doesn&apos;t point to a meeting that exists. Double-check the link, or ask the host for a
            fresh QR code.
          </p>
          <Link href="/" className="text-sm font-semibold text-gold hover:text-gold-dark">
            ← Go to the home page
          </Link>
        </div>
      </main>
    </div>
  );
}
