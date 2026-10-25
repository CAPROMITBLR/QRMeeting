import { apiError, json } from "@/lib/http";
import { sql } from "@/lib/db";
import { getHost } from "@/lib/host-session";
import { checkRateLimit, readJson } from "@/lib/request";
import { meetingRateLimiter } from "@/lib/rate-limit";
import { claimMeetingsSchema, firstIssueMessage } from "@/lib/schemas";

/**
 * One-time import of host links that older versions kept in localStorage.
 * A meeting is only claimed when the caller already holds its host key.
 */
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, meetingRateLimiter, "Too many requests. Please wait a minute.");
  if (limited) return limited;

  const host = await getHost();
  if (!host) return apiError(401, "not_signed_in", "Sign in first to import your meetings.");

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = claimMeetingsSchema.safeParse(body);
  if (!parsed.success) return apiError(400, "invalid_input", firstIssueMessage(parsed.error).message);

  let claimed = 0;
  try {
    for (const entry of parsed.data.meetings) {
      const rows = await sql`
        update public.meetings
        set host_id = ${host.id}
        where id = ${entry.id}
          and host_id is null
          and host_token = ${entry.key}
        returning id
      `;
      if (rows.length > 0) claimed += 1;
    }
    return json({ claimed });
  } catch (error) {
    console.error("claim meetings failed", error);
    return apiError(500, "server_error", "Could not import your saved meetings.");
  }
}
