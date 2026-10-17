# Meeting Attendance (QR)

A professor creates a meeting, shows a QR code, and attendees mark attendance from their phones. The host page
shows names arriving live, with optional on-site verification and automatic closing. No accounts, no Microsoft
login: the host page is protected by a secret key in its URL.

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS v4 · Supabase Postgres (via `postgres`) · `qrcode` · `zod`

## Setup

```bash
npm install
cp .env.example .env      # fill in PROJECT_URL + DATABASE_PASSWORD
npm run db:push           # schema + migrations, idempotent
npm run dev
```

| Variable | Where to find it |
| --- | --- |
| `PROJECT_URL` | Supabase → Project Settings → Data API |
| `DATABASE_PASSWORD` | Supabase → Project Settings → Database |
| `SUPABASE_DB_HOST` | Supabase → Connect → Transaction pooler (optional; defaults to this project's region) |
| `APP_BASE_URL` | Public origin used inside QR codes. Unset locally; set in production |

`DATABASE_URL` overrides all of the above. Supabase's direct host is IPv6-only, so the pooler is used everywhere.

## Flow

1. `/` — create a meeting: title, date/time, optional venue geofence (current location or manual lat/lng + radius),
   optional auto-close time. The server generates the meeting `id` and a 43-character `host_token`.
2. `/meetings/<id>?key=…` — host view: QR code + PNG download, attendee link, live list (3 s polling) with
   distance from the venue, CSV export, per-row removal, open/close toggle and auto-close controls. Bookmark it.
3. `/attend/<id>` — public form: full name (required), college ID (optional). Submitting marks attendance, sends
   the device's location, and shows a confirmation card.

## Features

- **Geofence** — set venue coordinates and a radius; attendance is rejected unless the device is inside it
  (haversine, `lib/geo.ts`). Positions with accuracy worse than 100 m are rejected with a retry hint. Meetings
  without coordinates skip the check. `attendance` stores `lat`, `lng` and `distance_m` for audit.
- **Auto-close** — optional `closes_at`; enforced on every mark (`now() >= closes_at` closes the meeting, no cron.
  The host page shows "Auto-closes at HH:MM" plus a live countdown, and can extend, clear or reopen.
- **Dashboard** — live count, name, college ID, time and distance; CSV export; delete a wrong entry with a
  confirmation dialog; meeting history kept in this browser's `localStorage` with a "Forget" button.
- **Abuse protection** — zod validation on every field, in-memory rate limits (10 attendance marks/min, 5 meeting
  creations/min per IP), unique indexes on name and device per meeting, constant-time host-key comparison.
- **Mobile first** — tested at 375 px: 16 px inputs (no iOS zoom), 48 px primary controls, single-column attend
  form, scrollable host table, large QR.

## API

| Route | Auth | Notes |
| --- | --- | --- |
| `POST /api/meetings` | none | `{ title, startsAt, lat?, lng?, radiusM?, closesAt? }` → `{ id, hostToken }` |
| `PATCH /api/meetings/[id]?key=` | host key | `{ is_open? , closes_at? }` — `closes_at: null` clears it |
| `GET /api/meetings/[id]/attendance?key=` | host key | `{ isOpen, autoClosed, closesAt, count, attendees[] }` |
| `GET /api/meetings/[id]/export.csv?key=` | host key | `<title-slug>-attendance.csv`, UTF-8 BOM, CRLF |
| `GET /api/meetings/[id]/qr.png?key=` | host key | PNG attachment named `<title-slug>-qr.png` |
| `DELETE /api/meetings/[id]/attendance/[attendanceId]?key=` | host key | removes one entry |
| `POST /api/attendance` | none | `{ meetingId, name, collegeId?, deviceId, lat?, lng?, accuracy? }` |

Errors from `POST /api/attendance`: `not_found` (404), `closed` (409, manual or auto), `duplicate_name` /
`duplicate_device` (409), `outside_range` / `location_required` / `location_inaccurate` (403), `invalid_input`
(400), `rate_limited` (429 with `Retry-After`), `server_error` (500). Every error carries a `message`.

## Security model

- The host key is compared with `timingSafeEqual` over SHA-256 digests; a wrong key and a missing meeting return
  the same 403, so ids cannot be probed.
- `host_token` is never selected on `/attend/<id>` and never returned by `POST /api/attendance`.
- Host key stays in the `?key=` query parameter (moving it to a sessionStorage + header flow would break refresh),
  and `Referrer-Policy: no-referrer` stops it leaking through referrers. `X-Content-Type-Options: nosniff` and
  `X-Frame-Options: DENY` are set on every route.
- CSV cells that start with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` to neutralise spreadsheet formula
  injection; quotes and separators are escaped, and cells are round-trip parsed in the test suite.
- RLS is enabled with zero policies; the app connects as the Postgres owner role.

## Deliberate limitations

- **Rate limits are in-memory and per instance.** On serverless the effective ceiling is limit × running
  instances. `lib/rate-limit.ts` exposes a `RateLimiter` interface; swap in Upstash (or any shared store) by
  implementing `check`.
- **Possession of the host link is the credential.** Anyone with it can view, export and close attendance.
- **One mark per device.** The device id lives in `localStorage`; clearing site data allows another mark (the name
  unique index still blocks a repeat under the same name).
- **Geolocation needs HTTPS** (or localhost) and permission; the attend page reports denied, unavailable, timeout
  and unsupported cases inline.
- Times display in IST (`DISPLAY_TIMEZONE` in `lib/config.ts`). College ID is optional — flip
  `COLLEGE_ID_REQUIRED` in the same file to require it in both the form and the API.

## Manual test checklist

1. **Geofence in range** — create a meeting with `lat 13.125128, lng 77.589878`, radius 100 m; mark with
   `lat 13.125578` → accepted, row shows `distance_m ≈ 50`, dashboard shows "50 m".
2. **Geofence out of range** — mark with `lat 13.129628` → 403 "You are about 500 m from the venue".
3. **Location missing / inaccurate** — mark without `lat`/`lng` → 403 asking for location access; mark with
   `accuracy: 250` → 403 suggesting to move near a window.
4. **Duplicate name** — same name, different device → 409 duplicate name (case/whitespace insensitive).
5. **Duplicate device** — different name, same device id → 409 duplicate device.
6. **Closed meeting** — toggle "Close attendance" → marking returns 409 and the attend page shows "closed".
7. **Auto-closed meeting** — create one with a past auto-close → 409 "closed automatically", host page shows
   "Auto-closed at …" with a "Reopen now" button; extend the time and marking works again.
8. **CSV opens correctly** — Export CSV, open in Excel/Sheets: 4 columns, no formula evaluation, names with
   commas/quotes intact.
9. **Delete entry** — press ✕ on a row, confirm, count drops; the row disappears and stays gone after refresh.
10. **Rate limits** — 11 attendance marks in a minute → 429 with `Retry-After`; 6 meeting creations in a minute →
    429.
11. **Mobile** — at 375 px: no horizontal page scroll, 16 px inputs, 48 px buttons, host table scrolls sideways.
12. **History** — after creating a meeting it appears under "Your meetings"; "Forget" removes it; the note about
    clearing browser data is visible.
