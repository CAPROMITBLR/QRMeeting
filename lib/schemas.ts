import { z } from "zod";

import {
  COLLEGE_ID_MAX_LENGTH,
  FACULTY_NOTE_MAX_LENGTH,
  MAX_MEANINGFUL_ACCURACY_M,
  NAME_MAX_LENGTH,
  RADIUS_MAX_M,
  RADIUS_MIN_M,
  TITLE_MAX_LENGTH,
  MEETING_DURATION_MAX_MINUTES,
} from "@/lib/config";
import { normalizeFacultyId } from "@/lib/faculty-directory";
import { isUuid, normalizeText, parseStartsAt } from "@/lib/validation";

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/** Trim, collapse whitespace, strip control characters, then bound the length. */
const cleanedText = (max: number, label: string) =>
  z
    .string()
    .transform((value) => normalizeText(value))
    .refine((value) => value.length > 0, { message: `${label} is required.` })
    .refine((value) => value.length <= max, {
      message: `${label} must be ${max} characters or fewer.`,
    });

export const createMeetingSchema = z
  .object({
    title: cleanedText(TITLE_MAX_LENGTH, "Meeting title"),
    startsAt: z.string(),
    lat: latitude.nullish(),
    lng: longitude.nullish(),
    radiusM: z.number().int().min(RADIUS_MIN_M).max(RADIUS_MAX_M).nullish(),
    closesAt: z.string().nullish(),
    durationMinutes: z.number().int().min(1).max(MEETING_DURATION_MAX_MINUTES).nullish(),
  })
  .superRefine((value, ctx) => {
    if (parseStartsAt(value.startsAt) === null) {
      ctx.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "A valid meeting date and time is required.",
      });
    }

    const hasLat = typeof value.lat === "number";
    const hasLng = typeof value.lng === "number";
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: "custom",
        path: ["lat"],
        message: "Provide both latitude and longitude, or neither.",
      });
    }

    if (value.closesAt && value.durationMinutes) {
      ctx.addIssue({
        code: "custom",
        path: ["durationMinutes"],
        message: "Use either a duration or an auto-close time, not both.",
      });
    }

    if (value.closesAt) {
      const closesAt = parseStartsAt(value.closesAt);
      const startsAt = parseStartsAt(value.startsAt);
      if (!closesAt) {
        ctx.addIssue({
          code: "custom",
          path: ["closesAt"],
          message: "Auto-close must be a valid date and time.",
        });
      } else if (startsAt && closesAt.getTime() <= startsAt.getTime()) {
        ctx.addIssue({
          code: "custom",
          path: ["closesAt"],
          message: "Auto-close must be after the meeting start.",
        });
      } else if (startsAt && closesAt.getTime() > startsAt.getTime() + MEETING_DURATION_MAX_MINUTES * 60_000) {
        ctx.addIssue({
          code: "custom",
          path: ["closesAt"],
          message: `Auto-close must be within ${MEETING_DURATION_MAX_MINUTES} minutes of the meeting start.`,
        });
      }
    }
  });

const attendanceFields = z.object({
  meetingId: z.string().refine(isUuid, { message: "This meeting does not exist." }),
  name: cleanedText(NAME_MAX_LENGTH, "Full name"),
  // Optional: the attend form lets people type their own details, and one
  // faculty member in the directory has no MAHE ID issued yet. Digits without
  // the "MAHE" prefix are accepted and completed here.
  collegeId: z
    .string()
    .nullish()
    .transform((value) => normalizeFacultyId(value))
    .refine((value) => value.length <= COLLEGE_ID_MAX_LENGTH, {
      message: `MAHE ID must be ${COLLEGE_ID_MAX_LENGTH} characters or fewer.`,
    }),
  department: z.string().nullish().transform((value) => normalizeText(value ?? "")).refine((value) => value.length <= 100, {
    message: "Department must be 100 characters or fewer.",
  }),
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, {
    message: "Could not identify this device. Reload the page and try again.",
  }),
  lat: latitude.nullish(),
  lng: longitude.nullish(),
  accuracy: z.number().min(0).max(MAX_MEANINGFUL_ACCURACY_M).nullish(),
});

function requireBothCoordinates(value: { lat?: number | null; lng?: number | null }, ctx: z.RefinementCtx) {
  const hasLat = typeof value.lat === "number";
  const hasLng = typeof value.lng === "number";
  if (hasLat !== hasLng) {
    ctx.addIssue({
      code: "custom",
      path: ["lat"],
      message: "Provide both latitude and longitude, or neither.",
    });
  }
}

export const attendanceSchema = attendanceFields.superRefine(requireBothCoordinates);

/** A geofence rejection the attendee turns into a request the host can act on. */
export const JOIN_REQUEST_REASONS = ["outside_range", "location_inaccurate", "location_required"] as const;

export const joinRequestSchema = attendanceFields
  .extend({
    reason: z.enum(JOIN_REQUEST_REASONS).default("outside_range"),
  })
  .superRefine(requireBothCoordinates);

export const decisionSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

/** "My MAHE ID is missing, or the details we load are wrong." */
export const FACULTY_REPORT_REASONS = ["id_missing", "details_incorrect", "other"] as const;

export const facultyReportSchema = z.object({
  meetingId: z.string().refine(isUuid, { message: "This meeting does not exist." }),
  maheId: z
    .string()
    .nullish()
    .transform((value) => normalizeFacultyId(value))
    .refine((value) => value.length <= COLLEGE_ID_MAX_LENGTH, {
      message: `MAHE ID must be ${COLLEGE_ID_MAX_LENGTH} characters or fewer.`,
    }),
  name: z.string().nullish().transform((value) => normalizeText(value ?? "")).refine((value) => value.length <= NAME_MAX_LENGTH, {
    message: `Name must be ${NAME_MAX_LENGTH} characters or fewer.`,
  }),
  department: z.string().nullish().transform((value) => normalizeText(value ?? "")).refine((value) => value.length <= 120, {
    message: "Department must be 120 characters or fewer.",
  }),
  reason: z.enum(FACULTY_REPORT_REASONS).default("id_missing"),
  note: z
    .string()
    .nullish()
    .transform((value) => normalizeText(value ?? ""))
    .refine((value) => value.length <= FACULTY_NOTE_MAX_LENGTH, {
      message: `Please keep the note under ${FACULTY_NOTE_MAX_LENGTH} characters.`,
    }),
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, { message: "Could not identify this device." }).nullish(),
});

export const facultyReportDecisionSchema = z.object({
  action: z.literal("resolve"),
});

export const updateMeetingSchema = z
  .object({
    is_open: z.boolean().optional(),
    closes_at: z.union([z.string(), z.null()]).optional(),
  })
  .superRefine((value, ctx) => {
    if (typeof value.closes_at === "string" && value.closes_at !== "" && !parseStartsAt(value.closes_at)) {
      ctx.addIssue({
        code: "custom",
        path: ["closes_at"],
        message: "Auto-close must be a valid date and time.",
      });
    }
  });

export function firstIssueMessage(error: z.ZodError): { field: string; message: string } {
  const issue = error.issues[0];
  return { field: String(issue?.path[0] ?? ""), message: issue?.message ?? "Invalid input." };
}
