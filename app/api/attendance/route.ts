import { after } from "next/server";

import { apiError, json } from "@/lib/http";
import { sql } from "@/lib/db";
import { decideGeofence } from "@/lib/geo";
import { notifyMeetingChanged } from "@/lib/realtime";
import { attendanceRateLimiter } from "@/lib/rate-limit";
import { attendanceSchema, firstIssueMessage } from "@/lib/schemas";
import { meetingWindowState } from "@/lib/time-window";
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

  // What the attendee typed is what gets recorded: the directory only autofills
  // the form, and the server must not silently rewrite someone's own name.
  const { meetingId, name, collegeId, department, deviceId, lat, lng, accuracy } = parsed.data;
  // Tracks whether the geofence check itself passed, so a later database error
  // can tell the attendee their location was not the problem.
  let locationVerified = false;

  try {

    const [meeting] = await sql<{
      title: string;
      is_open: boolean;
      starts_at: Date;
      lat: number | null;
      lng: number | null;
      radius_m: number;
      closes_at: Date | null;
    }[]>`
      select title, is_open, starts_at, lat, lng, radius_m, closes_at
      from public.meetings
      where id = ${meetingId}
    `;

    if (!meeting) return apiError(404, "not_found", "This meeting does not exist.");
    const initialWindowState = meetingWindowState(new Date(), meeting.starts_at, meeting.is_open, meeting.closes_at);
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
              message: `Your phone reported a GPS accuracy of about ${Math.round(accuracy ?? 0)} m, which is too vague to confirm the venue. If you are on site, request to join and the host can approve you.`,
              can_request_join: true,
              ...details,
            },
            { status: 403 },
          );
        }
        return json(
          {
            error: "outside_range",
            message: `You are ~${Math.round(decision.distanceM)} m from the venue (allowed ${meeting.radius_m} m${accuracyText}). If you are actually in the room, the venue pin or your GPS reading is off — request to join and the host can approve you.`,
            can_request_join: true,
            ...details,
          },
          { status: 403 },
        );
      }

      // Reached only when the geofence accepted this position.
      locationVerified = true;
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

    // After the response: tell the host page to refetch (no attendee data on the wire).
    after(() => notifyMeetingChanged(meetingId, "attendance"));

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
      // Say which of the two limits was hit: one mark per person, one per device.
      let duplicateDevice = false;
      try {
        const [existing] = await sql<{ device_id: string }[]>`
          select device_id
          from public.attendance
          where meeting_id = ${meetingId}
            and (lower(btrim(name)) = ${name.toLowerCase()} or device_id = ${deviceId})
          limit 1
        `;
        duplicateDevice = existing?.device_id === deviceId;
      } catch {
        // Fall through to the name-based message if the lookup fails.
      }
      return apiError(
        409,
        duplicateDevice ? "duplicate_device" : "duplicate_name",
        duplicateDevice
          ? "Attendance has already been marked from this device."
          : "Attendance has already been marked under this name. Ask the host to remove the earlier entry if it was a mistake.",
      );
    }
    console.error("mark attendance failed", error);
    return apiError(
      500,
      "server_error",
      locationVerified
        ? "Your location was verified, but we could not save your attendance because of a server problem on our side. Please ask the host to approve you manually."
        : "We could not save your attendance because of a server problem on our side. Please try again, or ask the host to approve you manually.",
    );
  }
}
