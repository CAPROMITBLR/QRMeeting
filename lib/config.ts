/** Flip to true to require the college ID / roll number on the attend form. */
export const COLLEGE_ID_REQUIRED = false;

export const TITLE_MAX_LENGTH = 120;
export const NAME_MAX_LENGTH = 100;
export const COLLEGE_ID_MAX_LENGTH = 50;

/** Timezone used when showing meeting times. */
export const DISPLAY_TIMEZONE = "Asia/Kolkata";

/** Geofence */
export const DEFAULT_RADIUS_M = 100;
export const RADIUS_MIN_M = 10;
export const RADIUS_MAX_M = 5_000;
export const MEETING_DURATION_MAX_MINUTES = 24 * 60;
export const MAX_ACCURACY_M = 100;
export const MAX_MEANINGFUL_ACCURACY_M = 100_000;

/** Rate limits (per client IP, per server instance). */
export const ATTENDANCE_RATE_LIMIT = 10;
export const MEETINGS_RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 60_000;

/** Host page polling interval. */
export const ATTENDANCE_POLL_MS = 3_000;
