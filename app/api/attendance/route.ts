import { apiError, json } from "@/lib/http";
import { EARLY_ENTRY_MINUTES } from "@/lib/config";
import { sql } from "@/lib/db";
import { decideGeofence } from "@/lib/geo";
import { attendanceRateLimiter } from "@/lib/rate-limit";
import { attendanceSchema, firstIssueMessage } from "@/lib/schemas";
import { meetingWindowState } from "@/lib/time-window";
import { verifyQrToken } from "@/lib/qr";
import { checkRateLimit, readJson } from "@/lib/request";

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, attendanceRateLimiter, "Too many attempts. Please wait a moment and try again.");
  if (limited) return limited;
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = attendanceSchema.safeParse(body);
  if (!parsed.success) {
    const { field, message } = firstIssueMessage(parsed.error);
    return apiError(field === "meetingId" ? 404 : 400, field === "meetingId" ? "not_found" : "invalid_input", message);
  }

  const { meetingId, name, collegeId, department, deviceId, lat, lng, accuracy, qrToken, qrSlot } = parsed.data;

  try {
    const [meeting] = await sql<{
      title: string;
      host_token: string;
      is_open: boolean;
      starts_at: Date;
      lat: number | null;
      lng: number | null;
      radius_m: number;
      closes_at: Date | null;
    }[]>`
      select title, host_token, is_open, starts_at, lat, lng, radius_m, closes_at
      from public.meetings
      where id = ${meetingId}
    `;

    if (!meeting) return apiError(404, "not_found", "This meeting does not exist.");
    if (!verifyQrToken(meeting.host_token, meetingId, qrToken, qrSlot)) {
      return apiError(403, "qr_expired", "QR expired, scan the screen again.");
    }
    const initialWindowState = meetingWindowState(new Date(), meeting.starts_at, meeting.is_open, meeting.closes_at);
    if (initialWindowState === "not_started") {
      return apiError(409, "not_started", "Attendance is not open yet. Please try again closer to the meeting start.");
    }
    if (initialWindowState === "closed") {
      return apiError(409, "closed", "Attendance is closed for this meeting.");
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

      const decision = decideGeofence(
        { lat: venueLat, lng: venueLng },
        { lat: lat as number, lng: lng as number },
        meeting.radius_m,
        typeof accuracy === "number" ? accuracy : null,
      );
      distanceM = Math.round(decision.distanceM * 10) / 10;
      if (process.env.NODE_ENV !== "production") {
        console.debug("attendance geofence", {
          userLat: lat,
          userLng: lng,
          accuracyM: accuracy,
          meetingLat: venueLat,
          meetingLng: venueLng,
          distanceM,
          radiusM: meeting.radius_m,
          decision: decision.reason,
          allowed: decision.allowed,
        });
      }
      if (!decision.allowed) {
        const accuracyText = typeof accuracy === "number" ? `, GPS accuracy ${Math.round(accuracy)} m` : "";
        const details = {
          distance_m: Math.round(decision.distanceM),
          accuracy_m: typeof accuracy === "number" ? Math.round(accuracy) : null,
          radius_m: meeting.radius_m,
        };
        if (decision.reason === "location_inaccurate") {
          return json(
            {
              error: "location_inaccurate",
              message: `Your GPS accuracy is about ${Math.round(accuracy ?? 0)} m; it must be 500 m or better. Move outside or near a window and try again.`,
              ...details,
            },
            { status: 403 },
          );
        }
        return json(
          {
            error: "outside_range",
            message: `You are ~${Math.round(decision.distanceM)} m away (allowed ${meeting.radius_m} m${accuracyText}). Move closer and try again.`,
            ...details,
          },
          { status: 403 },
        );
      }
    }

    const [row] = await sql<{ marked_at: Date }[]>`
      insert into public.attendance (meeting_id, name, college_id, department, device_id, lat, lng, distance_m, accuracy_m)
      select
        ${meetingId},
        ${name},
        ${collegeId || null},
        ${department || null},
        ${deviceId},
        ${typeof lat === "number" ? lat : null},
        ${typeof lng === "number" ? lng : null},
        ${distanceM},
        ${typeof accuracy === "number" ? accuracy : null}
      from public.meetings
      where id = ${meetingId}
        and is_open
        and now() >= starts_at - (${EARLY_ENTRY_MINUTES} * interval '1 minute')
        and (closes_at is null or closes_at > now())
      returning marked_at
    `;

    if (!row) {
      const [currentMeeting] = await sql<{
        is_open: boolean;
        starts_at: Date;
        closes_at: Date | null;
      }[]>`
        select is_open, starts_at, closes_at from public.meetings where id = ${meetingId}
      `;
      if (currentMeeting) {
        const state = meetingWindowState(new Date(), currentMeeting.starts_at, currentMeeting.is_open, currentMeeting.closes_at);
        if (state === "not_started") {
          return apiError(409, "not_started", "Attendance is not open yet. Please try again closer to the meeting start.");
        }
        if (state === "closed") {
          return apiError(409, "closed", "Attendance is closed for this meeting.");
        }
      }
      const [existing] = await sql<{ name: string; device_id: string }[]>`
        select name, device_id
        from public.attendance
        where meeting_id = ${meetingId}
          and (lower(btrim(name)) = ${name.toLowerCase()} or device_id = ${deviceId})
        limit 1
      `;
      if (existing?.device_id === deviceId) {
        return apiError(409, "duplicate_device", "Attendance has already been marked from this device.");
      }
      if (existing) {
        return apiError(409, "duplicate_name", "Attendance has already been marked under this name.");
      }
      return apiError(409, "closed", "Attendance could not be marked because the meeting changed state. Please try again.");
    }

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
