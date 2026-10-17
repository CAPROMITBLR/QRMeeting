import { apiError, getClientIp, json } from "@/lib/http";
import { DEFAULT_RADIUS_M } from "@/lib/config";
import { sql } from "@/lib/db";
import { generateHostKey } from "@/lib/host-key";
import { meetingRateLimiter } from "@/lib/rate-limit";
import { createMeetingSchema, firstIssueMessage } from "@/lib/schemas";
import { parseStartsAt } from "@/lib/validation";

export async function POST(request: Request) {
  const limit = await meetingRateLimiter.check(`ip:${getClientIp(request)}`);
  if (!limit.allowed) {
    const response = apiError(429, "rate_limited", "Too many meetings created. Please wait a minute and try again.");
    response.headers.set("retry-after", String(limit.retryAfterSeconds));
    return response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_body", "Expected a JSON body.");
  }

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

  try {
    const [meeting] = await sql<{ id: string }[]>`
      insert into public.meetings (title, host_token, starts_at, lat, lng, radius_m, closes_at)
      values (
        ${title},
        ${hostToken},
        ${startsAtDate.toISOString()},
        ${typeof lat === "number" ? lat : null},
        ${typeof lng === "number" ? lng : null},
        ${radiusM ?? DEFAULT_RADIUS_M},
        ${closesAtDate ? closesAtDate.toISOString() : null}
      )
      returning id
    `;

    return json({ id: meeting.id, hostToken }, { status: 201 });
  } catch (error) {
    console.error("create meeting failed", error);
    return apiError(500, "server_error", "Could not create the meeting. Please try again.");
  }
}
