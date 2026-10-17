import { apiError, json } from "@/lib/http";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { hostKeyMatches, readHostKey } from "@/lib/host-key";
import { isUuid } from "@/lib/validation";

type SyncRow = {
  name: string;
  college_id: string | null;
  marked_at: Date;
  distance_m: number | null;
};

export async function POST(request: Request, ctx: RouteContext<"/api/meetings/[id]/sync-sheets">) {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return apiError(503, "not_configured", "Google Sheets sync is not configured on this server.");
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) return apiError(403, "forbidden", "This host link is not valid.");

  try {
    const [meeting] = await sql<{ title: string; host_token: string; starts_at: Date }[]>`
      select title, host_token, starts_at from public.meetings where id = ${id}
    `;
    if (!meeting || !hostKeyMatches(readHostKey(request.url), meeting.host_token)) {
      return apiError(403, "forbidden", "This host link is not valid.");
    }

    const rows = await sql<SyncRow[]>`
      select name, college_id, marked_at, distance_m
      from public.attendance
      where meeting_id = ${id}
      order by marked_at asc
    `;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "syncAttendance",
          meeting: {
            id,
            title: meeting.title,
            startsAt: meeting.starts_at.toISOString(),
          },
          attendees: rows.map((row) => ({
            name: row.name,
            collegeId: row.college_id,
            markedAt: formatDateTime(row.marked_at),
            distanceM: row.distance_m === null ? null : Math.round(row.distance_m),
          })),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error("Google Sheets sync returned", response.status);
        return apiError(502, "sync_failed", "Google Sheets rejected the attendance sync.");
      }
    } finally {
      clearTimeout(timeout);
    }

    return json({ ok: true, count: rows.length });
  } catch (error) {
    console.error("Google Sheets sync failed", error);
    return apiError(502, "sync_failed", "Could not sync attendance to Google Sheets.");
  }
}
