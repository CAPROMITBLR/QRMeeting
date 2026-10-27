-- 006: faculty directory (MAHE IDs) and attendee issue reports.
-- Idempotent: safe to run repeatedly. Load the rows with `npm run db:seed-faculty`.

create table if not exists public.faculty (
  id          uuid primary key default gen_random_uuid(),
  mahe_id     text not null check (char_length(btrim(mahe_id)) between 3 and 32),
  name        text not null check (char_length(btrim(name)) between 1 and 100),
  department  text not null check (char_length(btrim(department)) between 1 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- MAHE IDs are the lookup key. A handful of IDs are shared by two people in the
-- source roster, so the person's name is part of the key instead of being
-- silently dropped.
create unique index if not exists faculty_mahe_id_name_key
  on public.faculty (mahe_id, name);

create index if not exists faculty_department_idx
  on public.faculty (department);

-- "My ID is missing / my details are wrong" reports from the attend form.
create table if not exists public.faculty_reports (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid references public.meetings (id) on delete cascade,
  mahe_id     text,
  name        text,
  department  text,
  reason      text not null default 'id_missing'
                check (reason in ('id_missing', 'details_incorrect', 'other')),
  note        text check (note is null or char_length(note) <= 500),
  device_id   text,
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists faculty_reports_meeting_status_idx
  on public.faculty_reports (meeting_id, status, created_at);

alter table public.faculty enable row level security;
alter table public.faculty_reports enable row level security;
