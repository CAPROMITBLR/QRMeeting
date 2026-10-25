"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "signup" | "signin";

const COPY: Record<Mode, { heading: string; blurb: string; action: string }> = {
  signup: {
    heading: "Create a host account",
    blurb: "Pick a name and a passphrase. Your meetings are saved on the server, so they open from any device.",
    action: "Create account",
  },
  signin: {
    heading: "Sign in",
    blurb: "Use the same name and passphrase you chose earlier to see your meetings on this device.",
    action: "Sign in",
  },
};

export function HostAuthPanel({ defaultMode = "signup" }: { defaultMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const copy = COPY[mode];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/host/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, passphrase, mode }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(data.message ?? "Could not sign you in. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex rounded-xl border border-line bg-cream p-1 text-xs font-semibold">
        {(["signup", "signin"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setMode(option);
              setError(null);
            }}
            className={`min-h-10 flex-1 rounded-lg px-3 py-2 transition ${
              mode === option ? "bg-white text-navy shadow-sm" : "text-slate-500 hover:text-navy"
            }`}
          >
            {option === "signup" ? "New host" : "I already have one"}
          </button>
        ))}
      </div>

      <div>
        <h2 className="font-serif text-xl font-bold text-navy">{copy.heading}</h2>
        <p className="mt-1 text-sm text-slate-500">{copy.blurb}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="host-name" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Your name
          </label>
          <input
            id="host-name"
            name="name"
            required
            maxLength={60}
            autoComplete="username"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Dr. A. Sharma"
            className="field focus:field-focus"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="host-passphrase"
            className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            Passphrase
          </label>
          <input
            id="host-passphrase"
            name="passphrase"
            type="password"
            required
            minLength={8}
            maxLength={200}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="At least 8 characters"
            className="field focus:field-focus"
          />
          <p className="text-[11px] text-slate-400">
            Remember it: it is the only way to open your meetings on another device. We store only a scrypt hash.
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-gold px-5 py-3 text-sm font-semibold text-white shadow-[0_6px_18px_-6px_rgba(182,127,63,0.8)] transition hover:bg-gold-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Please wait…" : copy.action}
        </button>
      </form>
    </div>
  );
}
