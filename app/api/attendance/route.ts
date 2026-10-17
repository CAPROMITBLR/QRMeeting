import { apiError, getClientIp, json } from "@/lib/http";
import { MAX_ACCURACY_M } from "@/lib/config";
import { sql } from "@/lib/db";
import { haversineMeters } from "@/lib/geo";
import { attendanceRateLimiter } from "@/lib/rate-limit";
import { attendanceSchema, firstIssueMessage } from "@/lib/schemas";

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

export async function POST(request: Request) {
  const limit = await attendanceRateLimiter.check(`ip:${getClientIp(request)}`);
  if (!limit.allowed) {
    const response = apiError(429, "rate_limited", "Too many attempts. Please wait a moment and try again.");
    response.headers.set("retry-after", String(limit.retryAfterSeconds));
    return response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_body", "Expected a JSON body.");
  }

  const parsed = attendanceSchema.safeParse(body);
  if (!parsed.success) {
    const { field, message } = firstIssueMessage(parsed.error);
    return apiError(field === "meetingId" ? 404 : 400, field === "meetingId" ? "not_found" : "invalid_input", message);
  }

  const { meetingId, name, collegeId, deviceId, lat, lng, accuracy } = parsed.data;

  try {
    const [meeting] = await sql<{
      title: string;
      is_open: boolean;
      lat: number | null;
      lng: number | null;
      radius_m: number;
      closes_at: Date | null;
    }[]>`
      select title, is_open, lat, lng, radius_m, closes_at
      from public.meetings
      where id = ${meetingId}
    `;

    if (!meeting) return apiError(404, "not_found", "This meeting does not exist.");
    if (!meeting.is_open) {
      return apiError(409, "closed", "Attendance is closed for this meeting.");
    }
    if (meeting.closes_at && Date.now() >= meeting.closes_at.getTime()) {
      return apiError(409, "closed", "Attendance closed automatically for this meeting.");
    }

    let distanceM: number | null = null;
    const venueLat = meeting.lat;
    const venueLng = meeting.lng;
    const geofenced = typeof venueLat === "number" && typeof venueLng === "number";

    if (geofenced) {
      if (typeof lat !== "number" || typeof lng !== "number") {
        return apiError(
          403,
          "location_required",
          "This meeting checks your location. Allow location access and try again.",
        );
      }

      if (typeof accuracy === "number" && accuracy > MAX_ACCURACY_M) {
        return apiError(
          403,
          "location_inaccurate",
          `Your location is only accurate to about ${Math.round(accuracy)} m. Step outside or near a window and try again.`,
        );
      }

      distanceM =
        Math.round(haversineMeters({ lat: venueLat, lng: venueLng }, { lat, lng }) * 10) / 10;

      if (distanceM > meeting.radius_m) {
        return apiError(
          403,
          "outside_range",
          `You are about ${Math.round(distanceM)} m from the venue (allowed ${meeting.radius_m} m). Move closer and try again.`,
        );
      }
    }

    // Explicit checks give a precise message; the unique indexes below still win any race.
    const [existing] = await sql<{ name: string; device_id: string }[]>`
      select name, device_id
      from public.attendance
      where meeting_id = ${meetingId}
        and (lower(btrim(name)) = ${name.toLowerCase()} or device_id = ${deviceId})
      limit 1
    `;

    if (existing) {
      if (existing.device_id === deviceId) {
        return apiError(409, "duplicate_device", "Attendance has already been marked from this device.");
      }
      return apiError(409, "duplicate_name", "Attendance has already been marked under this name.");
    }

    const [row] = await sql<{ marked_at: Date }[]>`
      insert into public.attendance (meeting_id, name, college_id, device_id, lat, lng, distance_m)
      values (
        ${meetingId},
        ${name},
        ${collegeId || null},
        ${deviceId},
        ${typeof lat === "number" ? lat : null},
        ${typeof lng === "number" ? lng : null},
        ${distanceM}
      )
      returning marked_at
    `;

    return json(
      {
        ok: true,
        name,
        markedAt: row.marked_at,
        meeting: { id: meetingId, title: meeting.title },
      },
      { status: 201 },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiError(409, "duplicate", "Attendance has already been marked for this meeting.");
    }
    console.error("mark attendance failed", error);
    return apiError(500, "server_error", "Could not mark attendance. Please try again.");
  }
}
