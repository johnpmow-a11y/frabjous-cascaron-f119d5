-- All Ads Manager social improvements: soundtrack selection, 11-digit profile IDs and feed view history.
create sequence if not exists public.aam_social_profile_id_seq start with 10000000000;
alter table public.aam_social_profiles add column if not exists profile_id bigint;
update public.aam_social_profiles set profile_id=nextval('public.aam_social_profile_id_seq') where profile_id is null;
alter table public.aam_social_profiles alter column profile_id set default nextval('public.aam_social_profile_id_seq');
alter table public.aam_social_profiles alter column profile_id set not null;
create unique index if not exists aam_social_profiles_profile_id_uidx on public.aam_social_profiles(profile_id);
alter table public.aam_social_posts add column if not exists sound_track_id text;
alter table public.aam_social_posts add column if not exists sound_title text;
alter table public.aam_social_posts add column if not exists sound_artist text;
alter table public.aam_social_posts add column if not exists sound_url text;
create table if not exists public.aam_social_post_views(customer_id uuid not null references public.customers(id) on delete cascade,post_id uuid not null references public.aam_social_posts(id) on delete cascade,viewed_at timestamptz not null default now(),primary key(customer_id,post_id));
create index if not exists aam_social_post_views_post_idx on public.aam_social_post_views(post_id,viewed_at desc);
alter table public.aam_social_post_views enable row level security;
