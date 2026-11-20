-- All Ads Manager social sound, status and repeat-view controls.
alter table public.aam_social_posts
  add column if not exists post_kind text not null default 'feed',
  add column if not exists expires_at timestamptz,
  add column if not exists sound_track_id text,
  add column if not exists sound_title text,
  add column if not exists sound_artist text,
  add column if not exists sound_artwork_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'aam_social_posts_post_kind_check'
      and conrelid = 'public.aam_social_posts'::regclass
  ) then
    alter table public.aam_social_posts
      add constraint aam_social_posts_post_kind_check
      check (post_kind in ('feed','status'));
  end if;
end $$;

create index if not exists aam_social_posts_kind_feed_idx
  on public.aam_social_posts(post_kind, moderation_status, created_at desc);

create index if not exists aam_social_posts_status_expiry_idx
  on public.aam_social_posts(expires_at)
  where post_kind = 'status';

create table if not exists public.aam_social_post_views (
  post_id uuid not null references public.aam_social_posts(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (post_id, customer_id)
);

create index if not exists aam_social_post_views_customer_time_idx
  on public.aam_social_post_views(customer_id, viewed_at desc);

alter table public.aam_social_post_views enable row level security;
revoke all on public.aam_social_post_views from anon, authenticated;
grant all on public.aam_social_post_views to service_role;
