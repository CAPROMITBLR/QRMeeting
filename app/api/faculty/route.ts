import { loadFacultyRoster } from "@/lib/faculty";
import { departmentOptions } from "@/lib/faculty-directory";
import { apiError, json } from "@/lib/http";
import { facultySearchRateLimiter } from "@/lib/rate-limit";
import { checkRateLimit } from "@/lib/request";

/**
 * The faculty directory (public.faculty) as one payload: the attend form
 * filters it locally for both the name and the MAHE ID field, and builds its
 * department dropdown from the same response, so the list is fetched once.
 */
export async function GET(request: Request) {
  const limited = await checkRateLimit(
    request,
    facultySearchRateLimiter,
    "Too many requests. Please wait a moment and try again.",
  );
  if (limited) return limited;

  try {
    const members = await loadFacultyRoster();
    return json(
      { members, departments: departmentOptions(members), total: members.length },
      { headers: { "cache-control": "private, max-age=300" } },
    );
  } catch (error) {
    console.error("faculty roster failed", error);
    return apiError(500, "server_error", "Could not load the faculty directory right now.");
  }
}
