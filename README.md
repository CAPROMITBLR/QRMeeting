# Meeting Attendance (QR)

Live link:

[qr-meeting-seven.vercel.app](https://qr-meeting-seven.vercel.app/)

A professor creates a meeting, shows a QR code, and attendees mark attendance from their phones. The host page
shows names arriving live, with optional on-site verification and automatic closing. There are no accounts of
any kind: a host is whoever holds the meeting's secret host link, and that link is the only credential.

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS v4 · Supabase Postgres (via `postgres`) · `qrcode` · `exceljs` · `zod`

## What Supabase does here

**Postgres** (transaction pooler, one client in `lib/db.ts`) holds everything the app stores:

| Table | Holds |
| --- | --- |
| `meetings` | title, `host_token`, `starts_at`, `is_open`, `closes_at`, geofence (`lat`, `lng`, `radius_m`), owning `host_id` |
| `attendance` | the mark itself: name, `college_id` (MAHE ID), department, `device_id`, `marked_at`, `lat`/`lng`/`distance_m`/`accuracy_m`, `manual_approval` |
| `join_requests` | geofence failures awaiting a host decision, with status and `decided_at` |
| `faculty` | the MAHE ID directory: 204 rows, 5 departments, keyed on `(name, mahe_id)` — one person has no ID yet |
| `faculty_reports` | "my ID is missing / my details are wrong" reports and their resolution |

Indexes do real work, not decoration: unique on `(meeting_id, lower(btrim(name)))` and `(meeting_id, device_id)`
for one mark per person and per device, one pending join request per device, and `on delete cascade` from
`meetings` so deleting a meeting takes its attendance, requests and reports with it. RLS is enabled with no
policies — nothing reaches these tables except the server's owner connection, and every browser-facing route
re-implements its own authorisation (a host key in the URL).

**Realtime** carries only invalidation signals: each write broadcasts a content-free `{ kind }` message to that
meeting's channel, and the host page answers by refetching the host-key-protected snapshot. Without the
publishable key the page polls every 3 s instead.

**Not used:** Supabase Auth, Storage, Edge Functions and the client-side `supabase-js` beyond the Realtime
socket. (`hosts` and `host_sessions` exist in the schema from an earlier version with host sign-in; the code no
longer writes or reads them, and they can be dropped safely.)

## Setup

```bash
npm install
cp .env.example .env      # fill in PROJECT_URL + DATABASE_PASSWORD
npm run db:push           # schema + migrations, idempotent
npm run db:seed-faculty   # loads FacultyList.xlsx into public.faculty (re-runnable)
npm run dev
```

| Variable | Where to find it |
| --- | --- |
| `PROJECT_URL` | Supabase → Project Settings → Data API (also the Realtime host) |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Connect / API keys. Optional: enables live host updates; without it the page polls every 3 s |
| `DATABASE_PASSWORD` | Supabase → Project Settings → Database |
| `SUPABASE_DB_HOST` | Supabase → Connect → Transaction pooler (optional; defaults to this project's region) |
| `APP_BASE_URL` | Public origin used inside QR codes. Unset locally; set in production |

`DATABASE_URL` overrides all of the above. Supabase's direct host is IPv6-only, so the pooler is used everywhere.

### Faculty directory

Attendance is keyed by MAHE ID, so the roster lives in Postgres (`public.faculty`) instead of a spreadsheet or an
Apps Script URL. `npm run db:seed-faculty` reads `FacultyList.xlsx` from the repo root (path override:
`node --env-file=.env scripts/seed-faculty.mjs path/to/roster.xlsx`) and upserts on `(name, mahe_id)` with NULLs
not distinct, so re-running updates departments instead of duplicating people — including the one person whose
MAHE ID has not been issued yet, who is stored with an empty ID and found by name. The spreadsheet is gitignored,
once seeded, on purpose: Postgres is the source of truth. The seeder prints skipped rows and IDs shared by two
people, so the roster can be corrected at the source.

## Flow

0. `/` — create a meeting, no sign-in. The server generates the meeting `id` and a 43-character `host_token`,
   and the link is saved in this browser's list so it can be reopened.
1. `/` — create a meeting: title, date/time (IST), optional duration, optional venue geofence (current location
   or manual coordinates + radius).
2. `/meetings` — the host links this browser has saved, newest first, with copy and forget controls. There is no
   server-side list: keep the link itself and the meeting opens on any device.
3. `/meetings/<id>?key=…` — host view: QR code + PNG download, attendee link, live list (instant when the
   publishable key is set, otherwise 3 s polling) with distance from the venue, pending join requests with
   Accept/Reject, directory reports to resolve, CSV/Excel export, per-row removal, open/close toggle and
   auto-close controls.
4. `/attend/<id>` — public form: a **name** field and a **MAHE ID** field (the `MAHE` prefix is fixed, so only the
   digits are typed), each listing the whole directory in ascending order until you narrow it, plus a department
   dropdown. Picking a row fills all three; typing your own name, ID and department works just as well. Submitting
   marks attendance, sends the device's location and shows a confirmation card. If the geofence check fails, the
   attendee can send a join request for the host to accept or reject; if their MAHE ID is missing or wrong, they
   can report it instead.
5. `/reports` — the shared directory-reports inbox: every open report across meetings, oldest first, with a
   Resolve action and instructions for fixing the roster.

## Features

- **Geofence** — set venue coordinates and a radius; attendance is rejected unless the device is inside it
  (haversine, `lib/geo.ts`). Positions with accuracy worse than 500 m are rejected; readings up to 150 m
  contribute an uncertainty buffer to the boundary decision. Meetings
  without coordinates skip the check. `attendance` stores `lat`, `lng` and `distance_m` for audit.
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
- **Saved links, not accounts** — every created meeting is remembered in this browser's `localStorage`
  (`lib/saved-meetings.ts`), so `/meetings` and the home page list them without a login. Nothing about a meeting
  is sent anywhere for that list: the host link itself is the credential, and copying it is what moves a meeting
  to another device.
- **Dashboard** — live count, name, MAHE ID, time and distance; CSV export; delete a wrong entry with a
  confirmation dialog.
- **Abuse protection** — zod validation on every field, in-memory rate limits (10 attendance marks/min, 5 meeting
  creations/min per IP), unique indexes on name and device per meeting, constant-time host-key comparison.
- **Mobile first** — tested at 375 px: 16 px inputs (no iOS zoom), 48 px primary controls, single-column attend
  form, scrollable host table, large QR.
- **Faculty directory** — `public.faculty` holds all 204 people from the roster across 5 departments (two share
  one MAHE ID; one has no ID issued yet). `GET /api/faculty` returns the whole list once, and the attend form
  filters it locally: the name field matches names, the ID field matches any digits inside an ID (so `178` finds
  `MAHE0017820`), and an empty field lists everyone ascending. Nothing is submitted until the person chooses.
- **Autofill, not lock** — picking a directory row fills name, ID and department, and a "From the directory"
  panel shows the rest of the row. Everything stays editable, because attendance records what the person typed;
  the directory is a convenience, not a source of truth. The MAHE ID field is prefixed with `MAHE` so only the
  digits are typed.
- **Directory issue reports** — "Can't find your MAHE ID?" / "These details aren't right?" opens a report form on
  the attend page. Reports land in `faculty_reports` and appear within a second (Realtime signal) on the host page
  under *Directory reports* and on the shared `/reports` inbox, with the typed ID, the claim as written, the
  reason and an optional note. Resolve clears it from both.
- **Department reporting** — attendance carries the department (picked from the directory's five, or typed), and
  Excel reports include department totals, attendance percentages, and present/absent reconciliation against the
  whole roster, including the person whose ID is missing.
- **Formatted Excel reports** — the host can download Summary, Department Summary, Attendance, and Faculty Status
  worksheets instead of relying only on CSV.
- **Meeting duration** — a duration can automatically expire the QR and attendance window; the host view shows a
  live QR expiry countdown.

## API

| Route | Auth | Notes |
| --- | --- | --- |
| `POST /api/meetings` | none | `{ title, startsAt, lat?, lng?, radiusM?, durationMinutes?, closesAt? }` → `{ id, hostToken }` |
| `PATCH /api/meetings/[id]?key=` | host key | `{ is_open? , closes_at? }` — `closes_at: null` clears it |
| `GET /api/meetings/[id]/attendance?key=` | host key | `{ isOpen, autoClosed, closesAt, count, attendees[], requests[], reports[] }` |
| `GET /api/faculty` | none | the whole directory: `{ members: [{ maheId, name, department }], departments[], total }`, cached privately for 5 minutes |
| `POST /api/faculty/reports` | none | `{ meetingId, maheId?, name?, department?, reason: "id_missing" \| "details_incorrect" \| "other", note?, deviceId? }` |
| `GET /api/faculty/reports` | none | every open report with its meeting title — feeds the `/reports` inbox |
| `POST /api/faculty/reports/[reportId]` | none | `{ action: "resolve" }` — resolving from the inbox |
| `POST /api/meetings/[id]/faculty-reports/[reportId]?key=` | host key | `{ action: "resolve" }` — resolving from the host page |
| `POST /api/join-requests` | none | `{ meetingId, name, collegeId, department, deviceId, lat?, lng?, accuracy?, reason }` → pending request |
| `POST /api/meetings/[id]/join-requests/[requestId]?key=` | host key | `{ action: "approve" \| "reject" }`; approve marks attendance |
| `GET /api/meetings/[id]/export.csv?key=` | host key | `<title-slug>-attendance.csv`, UTF-8 BOM, CRLF |
| `GET /api/meetings/[id]/export.xlsx?key=` | host key | Styled workbook with summary, department, attendance and faculty-status sheets |
| `GET /api/meetings/[id]/qr.png?key=` | host key | Static QR PNG attachment named `meeting_<last-8-id>.png` |
| `DELETE /api/meetings/[id]/attendance/[attendanceId]?key=` | host key | removes one entry |
| `POST /api/attendance` | none | `{ meetingId, name, collegeId, department, deviceId, lat?, lng?, accuracy? }` — typed values; bare digits get the `MAHE` prefix |

Errors from `POST /api/attendance`: `not_found` (404), `closed` (409), `duplicate_name` /
`duplicate_device` (409), `outside_range` / `location_required` / `location_inaccurate` (403), `invalid_input`
(400), `rate_limited` (429 with `Retry-After`), `server_error` (500). Every error carries a `message`, and the
geofence errors also carry `can_request_join: true` plus `distance_m`, `accuracy_m` and `radius_m` so the attend
page can explain exactly what failed. A `server_error` where the geofence had passed says so instead of blaming
the attendee.

Run `npm run db:push` after pulling: it applies `supabase/schema.sql` and every migration, including
`005_hosts_and_join_requests.sql` (join requests, `attendance.accuracy_m`),
`006_faculty_directory.sql` (`public.faculty`, `public.faculty_reports`) and
`007_faculty_without_mahe_id.sql` (a directory row may have no MAHE ID yet).

## Security model

- The host key is compared with `timingSafeEqual` over SHA-256 digests; a wrong key and a missing meeting return
  the same 403, so ids cannot be probed.
- `host_token` is never selected on `/attend/<id>` and never returned by `POST /api/attendance`.
- Host key stays in the `?key=` query parameter (moving it to a sessionStorage + header flow would break refresh),
  and `Referrer-Policy: no-referrer` stops it leaking through referrers. `X-Content-Type-Options: nosniff` and
  `X-Frame-Options: DENY` are set on every route.
- CSV cells that start with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` to neutralise spreadsheet formula
  injection; quotes and separators are escaped, and cells are round-trip parsed in the test suite.
- There are no accounts or cookies to steal: the host key in the URL is the whole credential, so the risk is
  link leakage rather than session hijacking. `/reports` is deliberately unauthenticated for the same reason —
  see the limitations.
- The faculty directory is served whole to anyone who opens an attendance link (the form filters it in the
  browser), behind a 60/min per-IP limit. It is a staff directory, not a secret: treat the URL as internal.
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
- **Saved links live in one browser.** With no accounts, a host's own list is `localStorage`; a new device starts
  empty and the link itself (a bookmark, a message) is what carries the meeting elsewhere. Clearing site data
  loses the list but not the meetings — they are still in Postgres and the links still work.
- **The reports inbox is unauthenticated.** `/reports` shows every open report — names, MAHE IDs, departments and
  notes — to anyone who knows the address, because a login was ruled out. Keep it internal, or gate it with a
  passphrase before it leaves the department.
- **Attendance is self-reported.** The name, ID and department recorded are whatever the person typed; the
  directory only autofills them. The geofence, the static QR and the per-device limit are the only things
  standing between a meeting and a proxy attendee.
- **One faculty member has no MAHE ID yet.** They are stored with an empty ID, findable and markable by name, and
  appear in the Excel report as "(no ID yet)". Two people share `MAHE0028678` in the source roster, so the picker
  shows both and the name disambiguates.
- **The roster spreadsheet is not in git** (`/*.xlsx` is ignored). A fresh clone needs the file present to run
  `db:seed-faculty`; the rows already loaded in Postgres are unaffected.
- Times display in IST (`DISPLAY_TIMEZONE` in `lib/config.ts`).

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
12. **No accounts** — create a meeting, then open `/meetings` in a fresh browser: the list is empty, because it is
    per browser. Copy the host link and open it in the second browser: the meeting opens there too, and creating
    another meeting adds it to that browser's list instead.
13. **Two search fields** — open `/attend/<id>`: focus the name field with nothing typed and the whole directory
    appears, ascending, with department and ID beside each name (the first 100, with a "more match" note); focus
    the ID field and every ID appears ascending. Typing `25979` in the ID field narrows to one person; typing
    `178` finds any ID containing those digits; typing `Iven` in the name field finds that person. The `MAHE`
    prefix is fixed in the ID field — only digits are typed.
14. **Autofill and manual entry** — pick a row from either field and all three fields fill in with a "From the
    directory" panel showing the rest of the row; edit anything and the panel clears. Typing your own name, digits
    and a department from the dropdown and submitting marks attendance just the same (a bare `9999999` is stored
    as `MAHE9999999`).
15. **Directory report** — open "Can't find your MAHE ID?", send a report; it appears on the host page under
    *Directory reports* and on `/reports` within a second, and Resolve clears it from both.
16. **What is recorded** — `POST /api/attendance` stores the typed name and department verbatim, and only adds the
    `MAHE` prefix to a bare ID; the directory is never consulted to rewrite them.
