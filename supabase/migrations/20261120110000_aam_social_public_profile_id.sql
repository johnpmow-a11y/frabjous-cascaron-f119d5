-- Stable public 11-digit profile IDs. Keep the UUID customer_id as the private relational key.
create sequence if not exists public.aam_social_profile_id_seq
  as bigint
  start with 10000000000
  minvalue 10000000000
  maxvalue 99999999999
  no cycle;

alter table public.aam_social_profiles
  add column if not exists profile_id bigint;

update public.aam_social_profiles
set profile_id = nextval('public.aam_social_profile_id_seq')
where profile_id is null;

alter table public.aam_social_profiles
  alter column profile_id set default nextval('public.aam_social_profile_id_seq');

alter table public.aam_social_profiles
  alter column profile_id set not null;

create unique index if not exists aam_social_profiles_profile_id_uidx
  on public.aam_social_profiles(profile_id);
