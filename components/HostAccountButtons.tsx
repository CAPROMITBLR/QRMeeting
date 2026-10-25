"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await fetch("/api/host/session", { method: "DELETE" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="text-xs font-semibold text-slate-500 transition hover:text-red-600 disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function RemoveMeetingButton({ meetingId, title }: { meetingId: string; title: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Remove "${title}" from your list? The host link keeps working.`)) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/host/meetings/${meetingId}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json()) as { message?: string };
        setError(data.message ?? "Could not remove this meeting.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="inline-flex min-h-10 items-center rounded-lg px-3 py-2 text-xs font-semibold text-slate-400 transition hover:text-red-600 disabled:opacity-60"
      >
        Remove
      </button>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </span>
  );
}
