# Meeting Attendance (QR)

Live link:

[qr-meeting-seven.vercel.app](https://qr-meeting-seven.vercel.app/)

A professor creates a meeting, shows a QR code, and attendees mark attendance from their phones. The host page
shows names arriving live, with optional on-site verification and automatic closing. No Microsoft or Google
login: hosts use a name + passphrase, and every host page is also protected by a secret key in its URL.

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
| `PROJECT_URL` | Supabase → Project Settings → Data API (also the Realtime host) |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Connect / API keys. Optional: enables live host updates; without it the page polls every 3 s |
| `DATABASE_PASSWORD` | Supabase → Project Settings → Database |
| `SUPABASE_DB_HOST` | Supabase → Connect → Transaction pooler (optional; defaults to this project's region) |
| `APP_BASE_URL` | Public origin used inside QR codes. Unset locally; set in production |
| `GOOGLE_SHEETS_FACULTY_URL` | Optional Apps Script GET endpoint returning the faculty roster |

`DATABASE_URL` overrides all of the above. Supabase's direct host is IPv6-only, so the pooler is used everywhere.

## Flow

0. `/` — sign in with a host name + passphrase (or create the account). Meetings are stored in Postgres against
   that account, so the list follows you to any device instead of living in one browser.
1. `/` (signed in) — create a meeting: title, date/time (IST), optional duration, optional venue geofence
   (AB4/AB5 campus preset, current location, or manual coordinates + radius). The server generates the meeting
   `id` and a 43-character `host_token`.
2. `/` list card and `/meetings` — every meeting owned by the signed-in host, newest first, with status and
   attendee count. `Remove` detaches a meeting from the list without invalidating its host link.
3. `/meetings/<id>?key=…` — host view: QR code + PNG download, attendee link, live list (instant when the
   publishable key is set, otherwise 3 s polling) with
   distance from the venue, pending join requests with Accept/Reject, CSV/Excel export, per-row removal,
   open/close toggle and auto-close controls.
4. `/attend/<id>` — public form: full name (required), college ID (optional). Submitting marks attendance, sends
   the device's location, and shows a confirmation card. If the geofence check fails, the attendee can send a
   join request for the host to accept or reject.

## Features

- **Geofence** — set venue coordinates and a radius; attendance is rejected unless the device is inside it
  (haversine, `lib/geo.ts`). Positions with accuracy worse than 500 m are rejected; readings up to 150 m
  contribute an uncertainty buffer to the boundary decision. Meetings
  without coordinates skip the check. `attendance` stores `lat`, `lng` and `distance_m` for audit.
- **Campus locations** — the meeting form includes the MAHE Bengaluru AB4 and AB5 presets. Presets show their
  coordinates and use a 45 m default radius that can be adjusted before creation.
- **Join requests** — a rejected geofence check (`outside_range`, `location_inaccurate`, `location_required`)
  offers the attendee a "Request to join" button. The request is stored in `join_requests`, appears on the host
  page within a second, and the host can approve (which inserts a `manual_approval` attendance row) or reject it.
  Repeated requests from the same device update the pending row instead of piling up.
- **Live host page** — every write (a mark, a join request, a decision, an open/close) broadcasts a content-free
  "changed" signal over Supabase Realtime, and the host page refetches its snapshot. The broadcast never carries
  attendee data, so a channel name leaking exposes nothing. Without `SUPABASE_PUBLISHABLE_KEY` the page falls
  back to polling every 3 s; with it, polling drops to a 30 s reconciliation while the socket is healthy.
- **Auto-close** — set only through the duration at creation (`closes_at` is derived server-side); enforced on
  every mark (`now() >= closes_at` closes the meeting, no cron). The host page shows "Auto-closes at HH:MM" plus
  a live countdown, and can extend, clear or reopen.
- **Host accounts** — name + passphrase, stored as a scrypt hash. A random session token lives in an HttpOnly
  cookie and `host_sessions`; meetings created while signed in get a `host_id`. Host links that older versions
  kept in `localStorage` are imported once into the account (only if their `host_token` still matches).
- **Dashboard** — live count, name, college ID, time and distance; CSV export; delete a wrong entry with a
  confirmation dialog; meeting list read from Postgres.
- **Abuse protection** — zod validation on every field, in-memory rate limits (10 attendance marks/min, 5 meeting
  creations/min per IP), unique indexes on name and device per meeting, constant-time host-key comparison.
- **Mobile first** — tested at 375 px: 16 px inputs (no iOS zoom), 48 px primary controls, single-column attend
  form, scrollable host table, large QR.
- **Department reporting** — attendance captures an optional department and Excel reports include department totals,
  attendance percentages, and present/absent reconciliation when a faculty roster is configured.
- **Formatted Excel reports** — the host can download Summary, Department Summary, Attendance, and Faculty Status
  worksheets instead of relying only on CSV.
- **Meeting duration** — a duration can automatically expire the QR and attendance window; the host view shows a
  live QR expiry countdown.

If `GOOGLE_SHEETS_FACULTY_URL` is configured, the attendee name field offers live faculty-name suggestions;
manual entry remains available if the roster is unavailable.

## API

| Route | Auth | Notes |
| --- | --- | --- |
| `POST /api/host/session` | none | `{ name, passphrase, mode: "signup" \| "signin" }` → `host`, sets the session cookie |
| `DELETE /api/host/session` | cookie | signs out and deletes the session row |
| `POST /api/host/claim` | cookie | imports legacy `localStorage` host links whose keys still match |
| `DELETE /api/host/meetings/[id]` | cookie | removes a meeting from your list (host link stays valid) |
| `POST /api/meetings` | optional cookie | `{ title, startsAt, lat?, lng?, radiusM?, durationMinutes?, closesAt? }` → `{ id, hostToken }`; linked to the signed-in host |
| `PATCH /api/meetings/[id]?key=` | host key | `{ is_open? , closes_at? }` — `closes_at: null` clears it |
| `GET /api/meetings/[id]/attendance?key=` | host key | `{ isOpen, autoClosed, closesAt, count, attendees[], requests[] }` |
| `POST /api/join-requests` | none | `{ meetingId, name, collegeId?, deviceId, lat?, lng?, accuracy?, reason }` → pending request |
| `POST /api/meetings/[id]/join-requests/[requestId]?key=` | host key | `{ action: "approve" \| "reject" }`; approve marks attendance |
| `GET /api/meetings/[id]/export.csv?key=` | host key | `<title-slug>-attendance.csv`, UTF-8 BOM, CRLF |
| `GET /api/meetings/[id]/export.xlsx?key=` | host key | Styled workbook with summary, department, attendance and faculty-status sheets |
| `GET /api/meetings/[id]/qr.png?key=` | host key | Static QR PNG attachment named `meeting_<last-8-id>.png` |
| `DELETE /api/meetings/[id]/attendance/[attendanceId]?key=` | host key | removes one entry |
| `POST /api/attendance` | none | `{ meetingId, name, collegeId?, deviceId, lat?, lng?, accuracy? }` |

Errors from `POST /api/attendance`: `not_found` (404), `closed` (409), `duplicate_name` /
`duplicate_device` (409), `outside_range` / `location_required` / `location_inaccurate` (403), `invalid_input`
(400), `rate_limited` (429 with `Retry-After`), `server_error` (500). Every error carries a `message`, and the
geofence errors also carry `can_request_join: true` plus `distance_m`, `accuracy_m` and `radius_m` so the attend
page can explain exactly what failed. A `server_error` where the geofence had passed says so instead of blaming
the attendee.

Run `npm run db:push` after pulling: it applies `supabase/schema.sql` and every migration, including
`005_hosts_and_join_requests.sql` (host accounts, join requests, `attendance.accuracy_m`).

## Security model

- The host key is compared with `timingSafeEqual` over SHA-256 digests; a wrong key and a missing meeting return
  the same 403, so ids cannot be probed.
- `host_token` is never selected on `/attend/<id>` and never returned by `POST /api/attendance`.
- Host key stays in the `?key=` query parameter (moving it to a sessionStorage + header flow would break refresh),
  and `Referrer-Policy: no-referrer` stops it leaking through referrers. `X-Content-Type-Options: nosniff` and
  `X-Frame-Options: DENY` are set on every route.
- CSV cells that start with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` to neutralise spreadsheet formula
  injection; quotes and separators are escaped, and cells are round-trip parsed in the test suite.
- Host passphrases are salted scrypt hashes. Session tokens are random 32-byte values whose SHA-256 hash is
  stored in `host_sessions`; the cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Realtime broadcasts are content-free (`{ kind }`) and carry no names or coordinates; the only data channel is
  the host-key-protected snapshot endpoint. The publishable key is browser-safe by design.
- RLS is enabled with zero policies; the app connects as the Postgres owner role.

## Deliberate limitations

- **Rate limits are in-memory and per instance.** On serverless the effective ceiling is limit × running
  instances. The limiter implementation is isolated in `lib/rate-limit.ts`; swap it for Upstash (or any shared
  store) by preserving the `check` contract.
- **Possession of the host link is the credential.** Anyone with it can view, export and close attendance.
- **One mark per device.** The device id lives in `localStorage`; clearing site data allows another mark (the name
  unique index still blocks a repeat under the same name).
- **Geolocation needs HTTPS** (or localhost) and permission; the attend page reports denied, unavailable, timeout
  and unsupported cases inline.
- **Live updates are best-effort.** The broadcast is an invalidation hint, not a log; a dropped message costs at
  most one 30 s reconciliation cycle (or a refetch when the tab regains focus). Without a publishable key the
  page polls every 3 s instead.
- **Host accounts have no email recovery.** The passphrase is the credential; a lost passphrase leaves the
  individual host links (which still work) as the only way back in. Meetings created before host accounts existed
  are claimed once from the old `localStorage` list.
- Times display in IST (`DISPLAY_TIMEZONE` in `lib/config.ts`). College ID is optional — flip
  `COLLEGE_ID_REQUIRED` in the same file to require it in both the form and the API.

### Attendance verification limits

Browser GPS can be spoofed or replaced by a crafted request. The static QR and geofence reduce
casual sharing and proxy attendance but do not eliminate it. The app has no in-app camera scanner; attendees use
their phone's camera or QR scanner to open the attendance link.

## Manual test checklist

1. **Geofence in range** — create a meeting with `lat 13.125128, lng 77.589878`, radius 100 m; mark with
   `lat 13.125578` → accepted, row shows `distance_m ≈ 50`, dashboard shows "50 m".
2. **Geofence out of range** — mark with `lat 13.129628` → 403 with the distance and an offer to request to
   join. Click "Request to join this meeting"; the host page shows it under "Join requests" and Approve adds the
   row with an `approved` badge (reject leaves the count unchanged).
3. **Location missing / inaccurate** — mark without `lat`/`lng` → 403 asking for location access; mark with
   `accuracy: 700` → 403 explaining the reading was too vague, with the same request-to-join offer.
4. **Duplicate name** — same name, different device → 409 duplicate name (case/whitespace insensitive).
5. **Duplicate device** — different name, same device id → 409 duplicate device.
6. **Closed meeting** — toggle "Close attendance" → marking returns 409 and the attend page shows "closed".
7. **Auto-closed meeting** — create one with a 30 minute duration and wait (or set `closes_at` in the past in
   SQL) → 409 closed, host page shows "Auto-closed at …" with a "Reopen now" button; extend the time and marking
   works again.
8. **CSV opens correctly** — Export CSV, open in Excel/Sheets: 4 columns, no formula evaluation, names with
   commas/quotes intact.
9. **Delete entry** — press ✕ on a row, confirm, count drops; the row disappears and stays gone after refresh.
10. **Rate limits** — 11 attendance marks in a minute → 429 with `Retry-After`; 6 meeting creations in a minute →
    429.
11. **Mobile** — at 375 px: no horizontal page scroll, 16 px inputs, 48 px buttons, host table scrolls sideways.
12. **Host account** — create a meeting, then open `/meetings` in a fresh browser (or incognito): sign in with
    the same name and passphrase, and the meeting is listed. "Remove" takes it off the list while the host link
    still opens it; "Sign out" hides the list again.
