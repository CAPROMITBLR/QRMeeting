"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// The old client-only meeting list. Read once after sign-in, move the meetings
// onto the account, then delete the local copy.
const LEGACY_STORAGE_KEY = "mqr-host-links";

type LegacyMeeting = { id: string; key: string };

function readLegacy(): LegacyMeeting[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is LegacyMeeting =>
          typeof (item as LegacyMeeting | null)?.id === "string" &&
          typeof (item as LegacyMeeting | null)?.key === "string",
      )
      .slice(0, 50);
  } catch {
    return [];
  }
}

export function ClaimLegacyMeetings() {
  const router = useRouter();
  const [imported, setImported] = useState(0);

  useEffect(() => {
    const meetings = readLegacy();
    if (meetings.length === 0) return;

    let active = true;
    fetch("/api/host/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meetings }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { claimed?: number } | null) => {
        if (!active) return;
        try {
          window.localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
          // Storage blocked; nothing to clean up.
        }
        if (data?.claimed) {
          setImported(data.claimed);
          router.refresh();
        }
      })
      .catch(() => {
        // Leave the local copy in place so the import can be retried later.
      });

    return () => {
      active = false;
    };
  }, [router]);

  if (imported === 0) return null;

  return (
    <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
      Imported {imported} meeting{imported === 1 ? "" : "s"} saved in this browser into your account.
    </p>
  );
}
