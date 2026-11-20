-- Idempotent All Ads Manager social support: numeric public IDs, presence, sound metadata and view history.
create sequence if not exists public.aam_social_profile_id_seq start with 10000000000;

alter table public.aam_social_profiles
  add column if not exists profile_id bigint;

update public.aam_social_profiles
set profile_id = nextval('public.aam_social_profile_id_seq')
where profile_id is null;

select setval(
  'public.aam_social_profile_id_seq',
  greatest(coalesce((select max(profile_id) from public.aam_social_profiles), 9999999999), 9999999999),
  true
);

alter table public.aam_social_profiles
  alter column profile_id set default nextval('public.aam_social_profile_id_seq'),
  alter column profile_id set not null;

create unique index if not exists aam_social_profiles_profile_id_uidx
  on public.aam_social_profiles(profile_id);

grant usage, select on sequence public.aam_social_profile_id_seq to service_role;

alter table public.aam_social_posts
  add column if not exists post_kind text not null default 'feed',
  add column if not exists expires_at timestamptz,
  add column if not exists sound_track_id text,
  add column if not exists sound_title text,
  add column if not exists sound_artist text,
  add column if not exists sound_url text,
  add column if not exists sound_artwork_url text;

create index if not exists aam_social_posts_kind_feed_idx
  on public.aam_social_posts(post_kind, moderation_status, created_at desc);

create table if not exists public.aam_social_post_views (
  customer_id uuid not null references public.customers(id) on delete cascade,
  post_id uuid not null references public.aam_social_posts(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (customer_id, post_id)
);

create index if not exists aam_social_post_views_post_idx
  on public.aam_social_post_views(post_id, viewed_at desc);

alter table public.aam_social_post_views enable row level security;
revoke all on table public.aam_social_post_views from anon, authenticated;
grant all on table public.aam_social_post_views to service_role;

create table if not exists public.aam_social_presence (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  online_until timestamptz not null default now() + interval '90 seconds'
);

create index if not exists aam_social_presence_online_idx
  on public.aam_social_presence(online_until desc);

alter table public.aam_social_presence enable row level security;
revoke all on table public.aam_social_presence from anon, authenticated;
grant all on table public.aam_social_presence to service_role;
