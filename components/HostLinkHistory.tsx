"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { formatDateTime } from "@/lib/format";
import {
  forgetHostLink,
  getHostLinks,
  getServerHostLinks,
  subscribeHostLinks,
} from "@/lib/host-links";

export function HostLinkHistory() {
  const links = useSyncExternalStore(subscribeHostLinks, getHostLinks, getServerHostLinks);

  if (links.length === 0) return null;

  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-lg font-bold text-navy">Your meetings</h2>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          Saved in this browser
        </span>
      </div>

      <ul className="flex flex-col divide-y divide-line/70">
        {links.map((meeting) => (
          <li key={meeting.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <Link
                href={`/meetings/${meeting.id}?key=${encodeURIComponent(meeting.key)}`}
                className="block truncate text-sm font-semibold text-navy hover:text-gold"
              >
                {meeting.title}
              </Link>
              <p className="text-xs text-slate-400">{formatDateTime(meeting.startsAt)} IST</p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/meetings/${meeting.id}?key=${encodeURIComponent(meeting.key)}`}
                className="inline-flex min-h-12 items-center rounded-lg border border-line px-3 py-2 text-xs font-semibold text-navy transition hover:border-gold hover:text-gold"
              >
                Open
              </Link>
              <button
                type="button"
                onClick={() => forgetHostLink(meeting.id)}
                className="inline-flex min-h-12 items-center rounded-lg px-3 py-2 text-xs font-semibold text-slate-400 transition hover:text-red-600"
              >
                Forget
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-slate-400">
        This list lives only in this browser. Clearing browser data, or using another device, loses it — keep the
        host link itself safe.
      </p>
    </section>
  );
}
