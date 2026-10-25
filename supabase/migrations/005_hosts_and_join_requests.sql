-- 005: host accounts (DB-backed meeting list), join requests, manual approvals.
-- Idempotent: safe to run repeatedly.

-- The insert in /api/attendance has always written accuracy_m; make sure the
-- deployed database actually has the column (004 may never have been applied).
alter table public.attendance
  add column if not exists accuracy_m double precision,
  add column if not exists manual_approval boolean not null default false;

-- Host accounts: one row per person; the passphrase is stored as a scrypt hash.
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

-- Attendees who failed the geofence check can ask the host to let them in.
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

-- One open request per device per meeting (repeat requests update the existing row).
create unique index if not exists join_requests_pending_device_key
  on public.join_requests (meeting_id, device_id)
  where status = 'pending';

create index if not exists join_requests_meeting_status_idx
  on public.join_requests (meeting_id, status, created_at);

alter table public.hosts enable row level security;
alter table public.host_sessions enable row level security;
alter table public.join_requests enable row level security;
