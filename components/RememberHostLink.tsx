"use client";

import { useEffect } from "react";

import { saveHostLink } from "@/lib/host-links";

export function RememberHostLink({
  id,
  title,
  hostKey,
  startsAt,
}: {
  id: string;
  title: string;
  hostKey: string;
  startsAt: string;
}) {
  useEffect(() => {
    saveHostLink({ id, title, key: hostKey, startsAt });
  }, [id, title, hostKey, startsAt]);

  return null;
}
