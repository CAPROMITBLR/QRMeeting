import { after } from "next/server";

import { apiError, json } from "@/lib/http";
import { MEETING_DURATION_MAX_MINUTES } from "@/lib/config";
import { sql } from "@/lib/db";
import { hostKeyMatches, readHostKey } from "@/lib/host-key";
import { notifyMeetingChanged } from "@/lib/realtime";
import { firstIssueMessage, updateMeetingSchema } from "@/lib/schemas";
import { isUuid, parseStartsAt } from "@/lib/validation";

export async function PATCH(request: Request, ctx: RouteContext<"/api/meetings/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return apiError(403, "forbidden", "This host link is not valid.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_body", "Expected a JSON body.");
  }

  const parsed = updateMeetingSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "invalid_input", firstIssueMessage(parsed.error).message);
  }

  const { is_open, closes_at } = parsed.data;
  if (is_open === undefined && closes_at === undefined) {
    return apiError(400, "invalid_input", "Nothing to update.");
  }

  let nextClosesAt: Date | null | undefined;
  if (closes_at === null || closes_at === "") {
    nextClosesAt = null;
  } else if (typeof closes_at === "string") {
    const parsedDate = parseStartsAt(closes_at);
    if (!parsedDate) return apiError(400, "invalid_input", "Auto-close must be a valid date and time.");
    nextClosesAt = parsedDate;
  }

  try {
    const [meeting] = await sql<{ host_token: string; is_open: boolean; starts_at: Date; closes_at: Date | null }[]>`
      select host_token, is_open, starts_at, closes_at from public.meetings where id = ${id}
    `;

    // Missing meeting and wrong key answer identically: no meeting-id probing.
    if (!meeting || !hostKeyMatches(readHostKey(request.url), meeting.host_token)) {
      return apiError(403, "forbidden", "This host link is not valid.");
    }
    if (
      nextClosesAt &&
      (nextClosesAt.getTime() <= meeting.starts_at.getTime() ||
        nextClosesAt.getTime() > meeting.starts_at.getTime() + MEETING_DURATION_MAX_MINUTES * 60_000)
    ) {
      return apiError(
        400,
        "invalid_input",
        `Auto-close must be after the meeting start and within ${MEETING_DURATION_MAX_MINUTES} minutes of it.`,
      );
    }

    const nextIsOpen = typeof is_open === "boolean" ? is_open : meeting.is_open;
    const closesAtValue = nextClosesAt === undefined ? meeting.closes_at : nextClosesAt;

    const [updated] = await sql<{ is_open: boolean; closes_at: Date | null }[]>`
      update public.meetings
      set is_open = ${nextIsOpen}, closes_at = ${closesAtValue}
      where id = ${id}
      returning is_open, closes_at
    `;

    after(() => notifyMeetingChanged(id, "meeting"));
    return json({ isOpen: updated.is_open, closesAt: updated.closes_at });
  } catch (error) {
    console.error("toggle meeting failed", error);
    return apiError(500, "server_error", "Could not update the meeting.");
  }
}
