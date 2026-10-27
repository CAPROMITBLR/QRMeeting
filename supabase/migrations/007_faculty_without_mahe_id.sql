-- 007: a faculty member can exist before their MAHE ID is issued.
-- The seeder keys rows on (name, mahe_id) with NULLs NOT DISTINCT so re-running
-- it updates that person instead of inserting a duplicate every time.

alter table public.faculty alter column mahe_id drop not null;

drop index if exists public.faculty_mahe_id_name_key;

create unique index if not exists faculty_name_mahe_id_key
  on public.faculty (name, mahe_id) nulls not distinct;
