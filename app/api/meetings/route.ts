import { apiError, json } from "@/lib/http";
import { DEFAULT_RADIUS_M } from "@/lib/config";
import { sql } from "@/lib/db";
import { generateHostKey } from "@/lib/host-key";
import { getHost } from "@/lib/host-session";
import { meetingRateLimiter } from "@/lib/rate-limit";
import { createMeetingSchema, firstIssueMessage } from "@/lib/schemas";
import { parseStartsAt } from "@/lib/validation";
import { checkRateLimit, readJson } from "@/lib/request";

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, meetingRateLimiter, "Too many meetings created. Please wait a minute and try again.");
  if (limited) return limited;
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = createMeetingSchema.safeParse(body);
  if (!parsed.success) {
    const { message } = firstIssueMessage(parsed.error);
    return apiError(400, "invalid_input", message);
  }

  const { title, startsAt, lat, lng, radiusM, closesAt, durationMinutes } = parsed.data;
  const startsAtDate = parseStartsAt(startsAt);
  if (!startsAtDate) return apiError(400, "invalid_input", "A valid meeting date and time is required.");

  const closesAtDate = closesAt
    ? parseStartsAt(closesAt)
    : durationMinutes
      ? new Date(startsAtDate.getTime() + durationMinutes * 60_000)
      : null;
  if (closesAt && !closesAtDate) {
    return apiError(400, "invalid_input", "Auto-close must be a valid date and time.");
  }

  const hostToken = generateHostKey();
  // Meetings created while signed in belong to the host account, so they show
  // up under "Your meetings" on every device instead of only in this browser.
  const host = await getHost();

  try {
    const [meeting] = await sql<{ id: string }[]>`
      insert into public.meetings (title, host_token, starts_at, lat, lng, radius_m, closes_at, host_id)
      values (
        ${title},
        ${hostToken},
        ${startsAtDate.toISOString()},
        ${typeof lat === "number" ? lat : null},
        ${typeof lng === "number" ? lng : null},
        ${radiusM ?? DEFAULT_RADIUS_M},
        ${closesAtDate ? closesAtDate.toISOString() : null},
        ${host?.id ?? null}
      )
      returning id
    `;

    return json({ id: meeting.id, hostToken }, { status: 201 });
  } catch (error) {
    console.error("create meeting failed", error);
    return apiError(500, "server_error", "Could not create the meeting. Please try again.");
  }
}
