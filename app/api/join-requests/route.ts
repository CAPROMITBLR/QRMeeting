import { after } from "next/server";

import { apiError, json } from "@/lib/http";
import { sql } from "@/lib/db";
import { haversineMeters } from "@/lib/geo";
import { notifyMeetingChanged } from "@/lib/realtime";
import { attendanceRateLimiter } from "@/lib/rate-limit";
import { firstIssueMessage, joinRequestSchema } from "@/lib/schemas";
import { meetingWindowState } from "@/lib/time-window";
import { checkRateLimit, readJson } from "@/lib/request";

/**
 * An attendee whose geofence check failed asks the host to let them in.
 * Repeating the request updates the pending row instead of piling up duplicates.
 */
export async function POST(request: Request) {
  const limited = await checkRateLimit(
    request,
    attendanceRateLimiter,
    "Too many attempts. Please wait a moment and try again.",
  );
  if (limited) return limited;

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const parsed = joinRequestSchema.safeParse(body);
  if (!parsed.success) {
    const { field, message } = firstIssueMessage(parsed.error);
    return apiError(field === "meetingId" ? 404 : 400, field === "meetingId" ? "not_found" : "invalid_input", message);
  }

  const { meetingId, name, collegeId, department, deviceId, lat, lng, accuracy, reason } = parsed.data;

  try {
    const [meeting] = await sql<{
      is_open: boolean;
      starts_at: Date;
      lat: number | null;
      lng: number | null;
      closes_at: Date | null;
    }[]>`
      select is_open, starts_at, lat, lng, closes_at
      from public.meetings
      where id = ${meetingId}
    `;

    if (!meeting) return apiError(404, "not_found", "This meeting does not exist.");
    if (meetingWindowState(new Date(), meeting.starts_at, meeting.is_open, meeting.closes_at) === "closed") {
      return apiError(409, "closed", "Attendance is closed for this meeting.");
    }

    const distanceM =
      typeof meeting.lat === "number" &&
      typeof meeting.lng === "number" &&
      typeof lat === "number" &&
      typeof lng === "number"
        ? Math.round(haversineMeters({ lat: meeting.lat, lng: meeting.lng }, { lat, lng }) * 10) / 10
        : null;

    const [alreadyMarked] = await sql<{ device_id: string }[]>`
      select device_id
      from public.attendance
      where meeting_id = ${meetingId}
        and (lower(btrim(name)) = lower(btrim(${name})) or device_id = ${deviceId})
      limit 1
    `;
    if (alreadyMarked) {
      return apiError(
        409,
        alreadyMarked.device_id === deviceId ? "duplicate_device" : "duplicate_name",
        alreadyMarked.device_id === deviceId
          ? "Attendance has already been marked from this device."
          : "Attendance has already been marked under this name.",
      );
    }

    const [created] = await sql<{ id: string; status: string }[]>`
      insert into public.join_requests
        (meeting_id, name, college_id, department, device_id, lat, lng, accuracy_m, distance_m, reason)
      values (
        ${meetingId},
        ${name},
        ${collegeId || null},
        ${department || null},
        ${deviceId},
        ${typeof lat === "number" ? lat : null},
        ${typeof lng === "number" ? lng : null},
        ${typeof accuracy === "number" ? accuracy : null},
        ${distanceM},
        ${reason}
      )
      on conflict (meeting_id, device_id) where status = 'pending'
      do update set
        name = excluded.name,
        college_id = excluded.college_id,
        department = excluded.department,
        lat = excluded.lat,
        lng = excluded.lng,
        accuracy_m = excluded.accuracy_m,
        distance_m = excluded.distance_m,
        reason = excluded.reason,
        created_at = now()
      returning id, status
    `;

    after(() => notifyMeetingChanged(meetingId, "request"));

    return json(
      {
        ok: true,
        requestId: created.id,
        status: created.status,
        distance_m: distanceM,
        message: "Request sent. The host can accept or reject it from the attendance page.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("join request failed", error);
    const detail =
      (error as { code?: string } | null)?.code === "42501"
        ? "The join-requests table is not set up in the database yet."
        : null;
    return apiError(
      500,
      "server_error",
      detail
        ? `${detail} Ask the host to run the database migrations.`
        : "Could not send your request to join right now. Please tell the host directly.",
    );
  }
}
