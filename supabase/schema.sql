-- Meeting QR attendance — Supabase Postgres schema.
-- Apply with: npm run db:push
-- RLS is enabled with no policies: only the server (postgres/service role) can touch these tables.

create table if not exists public.meetings (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  host_token  text not null check (char_length(host_token) >= 32),
  starts_at   timestamptz not null,
  created_at  timestamptz not null default now(),
  is_open     boolean not null default true,
  lat         double precision,
  lng         double precision,
  radius_m    integer not null default 100,
  closes_at   timestamptz
);

create index if not exists meetings_created_at_idx
  on public.meetings (created_at desc);

create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 100),
  college_id  text,
  department  text,
  device_id   text not null,
  marked_at   timestamptz not null default now(),
  lat         double precision,
  lng         double precision,
  distance_m  double precision
);

-- One row per person (case- and whitespace-insensitive) and one per device.
create unique index if not exists attendance_meeting_name_key
  on public.attendance (meeting_id, lower(btrim(name)));

create unique index if not exists attendance_meeting_device_key
  on public.attendance (meeting_id, device_id);

create index if not exists attendance_meeting_marked_idx
  on public.attendance (meeting_id, marked_at);

alter table public.meetings enable row level security;
alter table public.attendance enable row level security;
