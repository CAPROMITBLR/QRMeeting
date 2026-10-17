"use client";

import { useEffect, useState } from "react";

function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function QrCountdown({ closesAt }: { closesAt: string | null }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!closesAt) return;
    const update = () => setRemaining(Date.parse(closesAt) - Date.now());
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [closesAt]);

  if (!closesAt) {
    return <p className="text-center text-xs text-slate-400">QR stays active until you close attendance.</p>;
  }

  if (remaining !== null && remaining <= 0) {
    return <p className="text-center text-xs font-semibold text-red-600">QR expired — reopen attendance to reactivate it.</p>;
  }

  return (
    <p className="text-center text-xs text-gold-dark">
      QR expires in <span className="font-mono font-semibold">{remaining === null ? "…" : formatRemaining(remaining)}</span>
    </p>
  );
}
