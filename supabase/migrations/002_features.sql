-- Feature additions: geofence, audit coordinates, auto-close.
-- Idempotent: safe to run repeatedly.

alter table public.meetings
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists radius_m integer not null default 100,
  add column if not exists closes_at timestamptz;

alter table public.attendance
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists distance_m double precision;
