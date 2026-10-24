import "server-only";

import { cache } from "react";

import { sql } from "@/lib/db";
import { isUuid } from "@/lib/validation";

export type PublicMeeting = {
  id: string;
  title: string;
  starts_at: Date;
  is_open: boolean;
  lat: number | null;
  lng: number | null;
  radius_m: number;
  closes_at: Date | null;
};

/** Public columns only: never host_token. Cached per request via React's cache. */
export const getPublicMeeting = cache(async (id: string): Promise<PublicMeeting | null> => {
  if (!isUuid(id)) return null;
  const [meeting] = await sql<PublicMeeting[]>`
    select id, title, starts_at, is_open, lat, lng, radius_m, closes_at
    from public.meetings
    where id = ${id}
  `;
  return meeting ?? null;
});
