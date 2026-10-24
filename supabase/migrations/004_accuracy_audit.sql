alter table public.attendance
  add column if not exists accuracy_m double precision;
