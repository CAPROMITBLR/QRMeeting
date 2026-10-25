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
  closes_at   timestamptz,
  host_id     uuid
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
  distance_m  double precision,
  accuracy_m  double precision,
  manual_approval boolean not null default false
);

-- One row per person (case- and whitespace-insensitive) and one per device.
create unique index if not exists attendance_meeting_name_key
  on public.attendance (meeting_id, lower(btrim(name)));

create unique index if not exists attendance_meeting_device_key
  on public.attendance (meeting_id, device_id);

create index if not exists attendance_meeting_marked_idx
  on public.attendance (meeting_id, marked_at);

-- Host accounts. A host signs in with a name + passphrase; the session cookie
-- holds a random token whose SHA-256 hash is stored here.
create table if not exists public.hosts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(btrim(name)) between 2 and 60),
  passphrase_hash text not null,
  created_at      timestamptz not null default now()
);

create unique index if not exists hosts_name_key
  on public.hosts (lower(btrim(name)));

create table if not exists public.host_sessions (
  token_hash  text primary key,
  host_id     uuid not null references public.hosts (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists host_sessions_host_idx
  on public.host_sessions (host_id);

alter table public.meetings
  add column if not exists host_id uuid;

do $$
begin
  alter table public.meetings
    add constraint meetings_host_id_fkey
    foreign key (host_id) references public.hosts (id) on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists meetings_host_created_idx
  on public.meetings (host_id, created_at desc);

-- Geofence failures can become join requests the host accepts or rejects.
create table if not exists public.join_requests (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 100),
  college_id  text,
  department  text,
  device_id   text not null,
  lat         double precision,
  lng         double precision,
  accuracy_m  double precision,
  distance_m  double precision,
  reason      text not null default 'outside_range',
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

create unique index if not exists join_requests_pending_device_key
  on public.join_requests (meeting_id, device_id)
  where status = 'pending';

create index if not exists join_requests_meeting_status_idx
  on public.join_requests (meeting_id, status, created_at);

alter table public.meetings enable row level security;
alter table public.attendance enable row level security;
alter table public.hosts enable row level security;
alter table public.host_sessions enable row level security;
alter table public.join_requests enable row level security;
