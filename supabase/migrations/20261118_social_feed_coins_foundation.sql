-- All Ads Manager social feed, profiles, follows, coins and chat foundation.
-- Additive only: does not alter existing login, wallet, Paystack or tools tables.
begin;

create table if not exists public.aam_social_profiles (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  display_name text,
  bio text not null default '',
  avatar_path text,
  is_private boolean not null default false,
  comments_enabled boolean not null default true,
  referral_code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  adult_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aam_social_bio_length check (length(bio) <= 300)
);

insert into public.aam_social_profiles(customer_id, display_name)
select id, name from public.customers
on conflict (customer_id) do nothing;

create table if not exists public.aam_coin_balances (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  balance_coins bigint not null default 0 check (balance_coins >= 0),
  updated_at timestamptz not null default now()
);

insert into public.aam_coin_balances(customer_id)
select id from public.customers
on conflict (customer_id) do nothing;

create table if not exists public.aam_coin_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  reference text not null unique,
  transaction_type text not null check (transaction_type in
    ('follow_reward_sent','follow_reward_received','referral_reward','video_view','coin_purchase','admin_adjustment')),
  amount_coins bigint not null check (amount_coins <> 0),
  description text not null,
  related_customer_id uuid references public.customers(id) on delete set null,
  related_post_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists aam_coin_transactions_customer_created_idx
  on public.aam_coin_transactions(customer_id, created_at desc);

create table if not exists public.aam_social_follows (
  follower_id uuid not null references public.customers(id) on delete cascade,
  followed_id uuid not null references public.customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint aam_social_no_self_follow check (follower_id <> followed_id)
);
create index if not exists aam_social_follows_followed_idx on public.aam_social_follows(followed_id, created_at desc);

create table if not exists public.aam_social_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.customers(id) on delete cascade,
  referred_id uuid not null unique references public.customers(id) on delete cascade,
  referral_code text not null,
  reward_coins bigint not null default 500 check (reward_coins = 500),
  created_at timestamptz not null default now(),
  constraint aam_social_no_self_referral check (referrer_id <> referred_id)
);

create table if not exists public.aam_social_posts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  author_role text not null default 'customer' check (author_role in ('customer','admin')),
  media_type text not null check (media_type in ('image','video')),
  media_path text not null,
  thumbnail_path text,
  caption text not null default '',
  comments_enabled boolean not null default true,
  moderation_status text not null default 'pending' check (moderation_status in ('pending','published','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aam_social_post_author check (
    (author_role = 'customer' and customer_id is not null) or
    (author_role = 'admin' and customer_id is null)
  ),
  constraint aam_social_caption_length check (length(caption) <= 2200)
);
create index if not exists aam_social_posts_feed_idx
  on public.aam_social_posts(moderation_status, created_at desc);

create table if not exists public.aam_social_likes (
  post_id uuid not null references public.aam_social_posts(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, customer_id)
);

create table if not exists public.aam_social_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.aam_social_posts(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists aam_social_comments_post_idx on public.aam_social_comments(post_id, created_at asc);

create table if not exists public.aam_social_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.customers(id) on delete cascade,
  actor_id uuid references public.customers(id) on delete set null,
  event_type text not null check (event_type in ('profile_view','follow','like','comment','share','message','profile_update','system')),
  post_id uuid references public.aam_social_posts(id) on delete cascade,
  message_id uuid,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists aam_social_notifications_recipient_idx
  on public.aam_social_notifications(recipient_id, created_at desc);

create table if not exists public.aam_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.aam_chat_participants (
  conversation_id uuid not null references public.aam_chat_conversations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  last_seen_at timestamptz,
  primary key (conversation_id, customer_id)
);
create index if not exists aam_chat_participants_customer_idx on public.aam_chat_participants(customer_id);

create table if not exists public.aam_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.aam_chat_conversations(id) on delete cascade,
  sender_id uuid not null references public.customers(id) on delete cascade,
  message_type text not null default 'text' check (message_type in ('text','image','video','voice','shared_post')),
  body text not null default '',
  media_path text,
  shared_post_id uuid references public.aam_social_posts(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint aam_chat_message_body_length check (length(body) <= 5000)
);
create index if not exists aam_chat_messages_conversation_idx on public.aam_chat_messages(conversation_id, created_at asc);

create table if not exists public.aam_chat_message_reads (
  message_id uuid not null references public.aam_chat_messages(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, customer_id)
);

create table if not exists public.aam_social_preferences (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  notification_sound integer not null default 1 check (notification_sound between 1 and 15),
  chat_wallpaper text not null default 'default',
  custom_wallpaper_path text,
  profile_view_notifications boolean not null default true,
  follow_notifications boolean not null default true,
  like_notifications boolean not null default true,
  comment_notifications boolean not null default true,
  share_notifications boolean not null default true,
  message_notifications boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Private media bucket: media is served via short-lived signed URLs after server-side
-- session and visibility checks. Do not change the existing ads-manager-private bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('aam-social-media','aam-social-media',false,524288000,
  array['video/mp4','video/quicktime','video/webm','image/jpeg','image/png','image/webp','audio/webm','audio/mp4']::text[])
on conflict (id) do nothing;

-- All social tables are accessed through authenticated Netlify functions using
-- the existing server-side session model; browser roles receive no direct table access.
do $$
declare t text;
begin
  foreach t in array array[
    'aam_social_profiles','aam_coin_balances','aam_coin_transactions','aam_social_follows',
    'aam_social_referrals','aam_social_posts','aam_social_likes','aam_social_comments',
    'aam_social_notifications','aam_chat_conversations','aam_chat_participants',
    'aam_chat_messages','aam_chat_message_reads','aam_social_preferences'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

commit;
