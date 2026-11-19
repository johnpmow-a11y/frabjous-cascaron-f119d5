-- ALL ADS MANAGER — COMPLETE CUSTOMER EMAIL, SOCIAL, COINS, PROMOTION AND CALL SETUP
-- REPLACEMENT SCRIPT. Do not run the older ALL_ADS_MANAGER_CALLS_SETUP.sql file.
-- Includes customer email storage and corrected email validation; social feed, chats, rewards,
-- separate Free/Money Coins, video earnings, Manager Promotion, LiveKit calls and avatar safeguards.
-- Requires the existing All Ads Manager customers, customer_sessions and admin_sessions tables.

BEGIN;

DO $aam$
BEGIN
  IF to_regclass('public.customers') IS NULL OR to_regclass('public.customer_sessions') IS NULL OR to_regclass('public.admin_sessions') IS NULL THEN
    RAISE EXCEPTION 'The existing All Ads Manager customer and session tables must be present before this setup.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='name' AND data_type='text')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_sessions' AND column_name='token')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_sessions' AND column_name='expires_at') THEN
    RAISE EXCEPTION 'The existing All Ads Manager customer/session schema is incomplete. No changes were committed.';
  END IF;
END;
$aam$;

-- ===== supabase/migrations/20261115_customer_contact_emails.sql =====
-- Customer email addresses for All Ads Manager accounts.
-- Run once in Supabase SQL Editor.
create table if not exists public.customer_contact_emails (
  customer_id text primary key,
  email text not null,
  updated_at timestamptz not null default now()
);
alter table public.customer_contact_emails enable row level security;

create or replace function public.bt_customer_set_email(p_token text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_customer_id text;
begin
  if p_email is null or length(trim(p_email)) < 6 or trim(p_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$' then
    raise exception 'Enter a valid email address.';
  end if;
  select customer_id::text into v_customer_id
  from public.customer_sessions
  where token::text = p_token and expires_at > now()
  limit 1;
  if v_customer_id is null then raise exception 'Invalid or expired customer session.'; end if;
  insert into public.customer_contact_emails(customer_id,email,updated_at)
  values(v_customer_id,lower(trim(p_email)),now())
  on conflict(customer_id) do update set email=excluded.email,updated_at=now();
  return jsonb_build_object('ok',true,'email',lower(trim(p_email)));
end;
$$;

create or replace function public.bt_customer_email_get(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_customer_id text; v_email text;
begin
  select customer_id::text into v_customer_id
  from public.customer_sessions
  where token::text = p_token and expires_at > now()
  limit 1;
  if v_customer_id is null then raise exception 'Invalid or expired customer session.'; end if;
  select email into v_email from public.customer_contact_emails where customer_id=v_customer_id;
  return v_email;
end;
$$;

create or replace function public.bt_admin_customer_emails(p_token text)
returns table(customer_id text,email text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists(select 1 from public.admin_sessions where token::text=p_token and expires_at>now()) then
    raise exception 'Invalid or expired administrator session.';
  end if;
  return query select e.customer_id,e.email from public.customer_contact_emails e;
end;
$$;

revoke all on public.customer_contact_emails from anon, authenticated;
grant execute on function public.bt_customer_set_email(text,text) to anon, authenticated;
grant execute on function public.bt_customer_email_get(text) to anon, authenticated;
grant execute on function public.bt_admin_customer_emails(text) to anon, authenticated;

-- ===== supabase/migrations/20261115_fix_customer_email_validation.sql =====
-- Fix email validation for customer account email storage.
-- [.] matches a literal dot without backslash-escaping ambiguity in PostgreSQL.

create or replace function public.bt_customer_set_email(p_token text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_customer_id text;
begin
  if p_email is null
     or length(trim(p_email)) < 6
     or trim(p_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$' then
    raise exception 'Enter a valid email address.';
  end if;

  select customer_id::text into v_customer_id
  from public.customer_sessions
  where token::text = p_token and expires_at > now()
  limit 1;

  if v_customer_id is null then
    raise exception 'Invalid or expired customer session.';
  end if;

  insert into public.customer_contact_emails(customer_id,email,updated_at)
  values(v_customer_id,lower(trim(p_email)),now())
  on conflict(customer_id) do update
    set email=excluded.email,updated_at=now();

  return jsonb_build_object('ok',true,'email',lower(trim(p_email)));
end;
$$;

revoke all on function public.bt_customer_set_email(text,text) from public;
grant execute on function public.bt_customer_set_email(text,text) to anon, authenticated;

-- ===== supabase/migrations/20261118090000_social_feed_coins_foundation.sql =====
-- All Ads Manager social feed, profiles, follows, coins and chat foundation.
-- Additive only: does not alter existing login, wallet, Paystack or tools tables.

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

create table if not exists public.aam_social_admin_profile (
  id boolean primary key default true check (id=true),
  display_name text not null default 'All Ads Manager',
  avatar_path text,
  follower_count bigint not null default 0 check (follower_count between 0 and 100000000),
  is_verified boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.aam_social_admin_profile(id) values(true) on conflict(id) do nothing;

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
ALTER TABLE public.aam_social_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_social_profiles FROM public, anon, authenticated;
GRANT ALL ON public.aam_social_profiles TO service_role;
ALTER TABLE public.aam_social_admin_profile ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_social_admin_profile FROM public, anon, authenticated;
GRANT ALL ON public.aam_social_admin_profile TO service_role;
ALTER TABLE public.aam_coin_balances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_coin_balances FROM public, anon, authenticated;
GRANT ALL ON public.aam_coin_balances TO service_role;
ALTER TABLE public.aam_coin_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_coin_transactions FROM public, anon, authenticated;
GRANT ALL ON public.aam_coin_transactions TO service_role;
ALTER TABLE public.aam_social_follows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_social_follows FROM public, anon, authenticated;
GRANT ALL ON public.aam_social_follows TO service_role;
ALTER TABLE public.aam_social_referrals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_social_referrals FROM public, anon, authenticated;
GRANT ALL ON public.aam_social_referrals TO service_role;
ALTER TABLE public.aam_social_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_social_posts FROM public, anon, authenticated;
GRANT ALL ON public.aam_social_posts TO service_role;
ALTER TABLE public.aam_social_likes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_social_likes FROM public, anon, authenticated;
GRANT ALL ON public.aam_social_likes TO service_role;
ALTER TABLE public.aam_social_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_social_comments FROM public, anon, authenticated;
GRANT ALL ON public.aam_social_comments TO service_role;
ALTER TABLE public.aam_social_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_social_notifications FROM public, anon, authenticated;
GRANT ALL ON public.aam_social_notifications TO service_role;
ALTER TABLE public.aam_chat_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_chat_conversations FROM public, anon, authenticated;
GRANT ALL ON public.aam_chat_conversations TO service_role;
ALTER TABLE public.aam_chat_participants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_chat_participants FROM public, anon, authenticated;
GRANT ALL ON public.aam_chat_participants TO service_role;
ALTER TABLE public.aam_chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_chat_messages FROM public, anon, authenticated;
GRANT ALL ON public.aam_chat_messages TO service_role;
ALTER TABLE public.aam_chat_message_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_chat_message_reads FROM public, anon, authenticated;
GRANT ALL ON public.aam_chat_message_reads TO service_role;
ALTER TABLE public.aam_social_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aam_social_preferences FROM public, anon, authenticated;
GRANT ALL ON public.aam_social_preferences TO service_role;

-- ===== supabase/migrations/20261118090100_social_customer_init.sql =====
-- Automatically provision a social profile and separate zero coin balance for every new account.

create or replace function public.aam_social_initialize_customer()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.aam_social_profiles(customer_id,display_name)
  values(new.id,new.name)
  on conflict(customer_id) do nothing;
  insert into public.aam_coin_balances(customer_id,balance_coins)
  values(new.id,0)
  on conflict(customer_id) do nothing;
  return new;
end;
$$;
drop trigger if exists aam_social_customer_created on public.customers;
create trigger aam_social_customer_created
after insert on public.customers
for each row execute function public.aam_social_initialize_customer();
revoke all on function public.aam_social_initialize_customer() from public,anon,authenticated;
grant execute on function public.aam_social_initialize_customer() to service_role;

-- ===== supabase/migrations/20261118090200_social_rewards_and_video_unlocks.sql =====
-- Secure, idempotent social reward and video-unlock operations.
-- Coin purchases are intentionally not connected to Paystack in this migration.

create table if not exists public.aam_social_video_unlocks (
  customer_id uuid not null references public.customers(id) on delete cascade,
  post_id uuid not null references public.aam_social_posts(id) on delete cascade,
  coin_transaction_id uuid unique references public.aam_coin_transactions(id) on delete set null,
  unlocked_at timestamptz not null default now(),
  primary key (customer_id, post_id)
);
ALTER TABLE public.aam_social_video_unlocks ADD COLUMN IF NOT EXISTS coins_charged bigint NOT NULL DEFAULT 1;
ALTER TABLE public.aam_social_video_unlocks ADD COLUMN IF NOT EXISTS coin_transaction_id uuid REFERENCES public.aam_coin_transactions(id) ON DELETE SET NULL;
alter table public.aam_social_video_unlocks enable row level security;
revoke all on public.aam_social_video_unlocks from public, anon, authenticated;
grant all on public.aam_social_video_unlocks to service_role;

create or replace function public.aam_social_confirm_age(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_customer uuid;
begin
  select customer_id into v_customer from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_customer is null then raise exception 'Session expired'; end if;
  insert into public.aam_social_profiles(customer_id,adult_confirmed_at)
  values(v_customer,now())
  on conflict(customer_id) do update set adult_confirmed_at=coalesce(public.aam_social_profiles.adult_confirmed_at,now());
  return jsonb_build_object('confirmed',true);
end;
$$;

create or replace function public.aam_social_follow(p_token uuid,p_target uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_follower uuid; v_inserted integer; v_balance bigint;
begin
  select customer_id into v_follower from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_follower is null then raise exception 'Session expired'; end if;
  if not exists(select 1 from public.aam_social_profiles where customer_id=v_follower and adult_confirmed_at is not null) then raise exception 'Confirm that you are 18 or older first'; end if;
  if v_follower=p_target then raise exception 'You cannot follow your own profile'; end if;
  if not exists(select 1 from public.customers where id=p_target) then raise exception 'Friend not found'; end if;
  insert into public.aam_social_profiles(customer_id)
  values(v_follower),(p_target) on conflict(customer_id) do nothing;
  insert into public.aam_social_follows(follower_id,followed_id)
  values(v_follower,p_target) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=1 then
    insert into public.aam_coin_balances(customer_id,balance_coins)
    values(v_follower,35) on conflict(customer_id) do update
      set balance_coins=public.aam_coin_balances.balance_coins+35,updated_at=now();
    insert into public.aam_coin_balances(customer_id,balance_coins)
    values(p_target,60) on conflict(customer_id) do update
      set balance_coins=public.aam_coin_balances.balance_coins+60,updated_at=now();
    insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description,related_customer_id)
    values
      (v_follower,'follow:'||v_follower::text||':'||p_target::text||':follower','follow_reward_sent',35,'Reward for following a friend',p_target),
      (p_target,'follow:'||v_follower::text||':'||p_target::text||':followed','follow_reward_received',60,'Reward for receiving a new follower',v_follower)
    on conflict(reference) do nothing;
    insert into public.aam_social_notifications(recipient_id,actor_id,event_type,title,body)
    values(p_target,v_follower,'follow','New follower','Someone followed your profile.');
  end if;
  select balance_coins into v_balance from public.aam_coin_balances where customer_id=v_follower;
  return jsonb_build_object('following',true,'new_follow',v_inserted=1,'coins_earned',case when v_inserted=1 then 35 else 0 end,'coin_balance',coalesce(v_balance,0));
end;
$$;

create or replace function public.aam_social_apply_referral(p_token uuid,p_referral_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_customer uuid; v_referrer uuid; v_code text; v_inserted integer;
begin
  select customer_id into v_customer from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_customer is null then raise exception 'Session expired'; end if;
  v_code=upper(trim(coalesce(p_referral_code,'')));
  if v_code='' then return jsonb_build_object('applied',false,'reason','no_code'); end if;
  select customer_id into v_referrer from public.aam_social_profiles where referral_code=v_code;
  if v_referrer is null then raise exception 'Referral number not found'; end if;
  if v_referrer=v_customer then raise exception 'You cannot use your own referral number'; end if;
  insert into public.aam_social_referrals(referrer_id,referred_id,referral_code)
  values(v_referrer,v_customer,v_code) on conflict(referred_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=1 then
    insert into public.aam_coin_balances(customer_id,balance_coins)
    values(v_referrer,500) on conflict(customer_id) do update
      set balance_coins=public.aam_coin_balances.balance_coins+500,updated_at=now();
    insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description,related_customer_id)
    values(v_referrer,'referral:'||v_customer::text,'referral_reward',500,'Referral registration reward',v_customer)
    on conflict(reference) do nothing;
  end if;
  return jsonb_build_object('applied',v_inserted=1,'referrer_reward_coins',case when v_inserted=1 then 500 else 0 end);
end;
$$;

create or replace function public.aam_social_unlock_video(p_token uuid,p_post_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_customer uuid; v_balance bigint; v_post public.aam_social_posts; v_unlock public.aam_social_video_unlocks;
begin
  select customer_id into v_customer from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_customer is null then raise exception 'Session expired'; end if;
  select * into v_post from public.aam_social_posts
  where id=p_post_id and media_type='video' and moderation_status='published';
  if v_post.id is null then raise exception 'Video is unavailable'; end if;
  if v_post.customer_id=v_customer then
    return jsonb_build_object('unlocked',true,'own_video',true);
  end if;
  if v_post.customer_id is not null and exists(select 1 from public.aam_social_profiles where customer_id=v_post.customer_id and is_private=true) and not exists(select 1 from public.aam_social_follows where follower_id=v_customer and followed_id=v_post.customer_id) then raise exception 'This profile is private'; end if;
  if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then
    raise exception 'Confirm that you are 18 or older to continue';
  end if;
  insert into public.aam_social_video_unlocks(customer_id,post_id)
  values(v_customer,p_post_id) on conflict do nothing returning * into v_unlock;
  if v_unlock.customer_id is null then
    select balance_coins into v_balance from public.aam_coin_balances where customer_id=v_customer;
    return jsonb_build_object('unlocked',true,'already_unlocked',true,'coin_balance',coalesce(v_balance,0));
  end if;
  select balance_coins into v_balance from public.aam_coin_balances where customer_id=v_customer for update;
  if coalesce(v_balance,0)<1 then
    delete from public.aam_social_video_unlocks where customer_id=v_customer and post_id=p_post_id;
    raise exception 'Insufficient coins';
  end if;
  update public.aam_coin_balances set balance_coins=balance_coins-1,updated_at=now()
  where customer_id=v_customer returning balance_coins into v_balance;
  insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description,related_post_id)
  values(v_customer,'video:'||v_customer::text||':'||p_post_id::text,'video_view',-1,'Unlocked a video',p_post_id)
  returning id into v_unlock.coin_transaction_id;
  update public.aam_social_video_unlocks set coin_transaction_id=v_unlock.coin_transaction_id
  where customer_id=v_customer and post_id=p_post_id;
  return jsonb_build_object('unlocked',true,'coin_balance',v_balance,'coins_charged',1);
end;
$$;

revoke all on function public.aam_social_confirm_age(uuid) from public, anon, authenticated;
revoke all on function public.aam_social_follow(uuid,uuid) from public, anon, authenticated;
revoke all on function public.aam_social_apply_referral(uuid,text) from public, anon, authenticated;
revoke all on function public.aam_social_unlock_video(uuid,uuid) from public, anon, authenticated;
grant execute on function public.aam_social_confirm_age(uuid) to service_role;
grant execute on function public.aam_social_follow(uuid,uuid) to service_role;
grant execute on function public.aam_social_apply_referral(uuid,text) to service_role;
grant execute on function public.aam_social_unlock_video(uuid,uuid) to service_role;

-- ===== supabase/migrations/20261118090300_social_interactions_chat_rpc.sql =====
-- Complete the social interaction and chat RPCs used by the Netlify functions.
-- Additive only. Existing login, Paystack wallet, tools and email remain untouched.

-- Private voice-note storage, separate from the existing private-media bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('aam-social-voice','aam-social-voice',false,12582912,array['audio/webm','audio/mp4']::text[])
on conflict (id) do nothing;

create or replace function public.aam_social_toggle_like(p_token uuid,p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_owner uuid; v_deleted integer; v_count bigint;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then raise exception 'Confirm that you are 18 or older first'; end if;
 select customer_id into v_owner from public.aam_social_posts where id=p_post_id and moderation_status='published';
 if not found then raise exception 'Post is unavailable'; end if;
 if v_owner is not null and v_owner<>v_customer and exists(select 1 from public.aam_social_profiles where customer_id=v_owner and is_private=true) and not exists(select 1 from public.aam_social_follows where follower_id=v_customer and followed_id=v_owner) then raise exception 'This profile is private'; end if;
 delete from public.aam_social_likes where post_id=p_post_id and customer_id=v_customer;
 get diagnostics v_deleted=row_count;
 if v_deleted=0 then
   insert into public.aam_social_likes(post_id,customer_id) values(p_post_id,v_customer) on conflict do nothing;
   if v_owner is not null and v_owner<>v_customer then
     insert into public.aam_social_notifications(recipient_id,actor_id,event_type,post_id,title,body)
     values(v_owner,v_customer,'like',p_post_id,'New like','Someone liked your post.');
   end if;
 end if;
 select count(*) into v_count from public.aam_social_likes where post_id=p_post_id;
 return jsonb_build_object('liked',v_deleted=0,'like_count',v_count);
end $$;

create or replace function public.aam_social_add_comment(p_token uuid,p_post_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_owner uuid; v_id uuid; v_body text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then raise exception 'Confirm that you are 18 or older first'; end if;
 v_body=trim(coalesce(p_body,''));
 if length(v_body)<1 or length(v_body)>2000 then raise exception 'Comment must be between 1 and 2,000 characters'; end if;
 select p.customer_id into v_owner from public.aam_social_posts p
 where p.id=p_post_id and p.moderation_status='published' and p.comments_enabled=true;
 if not found then raise exception 'Comments are unavailable for this post'; end if;
 if v_owner is not null and v_owner<>v_customer and exists(select 1 from public.aam_social_profiles where customer_id=v_owner and is_private=true) and not exists(select 1 from public.aam_social_follows where follower_id=v_customer and followed_id=v_owner) then raise exception 'This profile is private'; end if;
 if v_owner is not null and exists(select 1 from public.aam_social_profiles where customer_id=v_owner and comments_enabled=false) then raise exception 'This creator has disabled comments'; end if;
 insert into public.aam_social_comments(post_id,customer_id,body)
 values(p_post_id,v_customer,v_body) returning id into v_id;
 if v_owner is not null and v_owner<>v_customer then
   insert into public.aam_social_notifications(recipient_id,actor_id,event_type,post_id,title,body)
   values(v_owner,v_customer,'comment',p_post_id,'New comment',left(v_body,180));
 end if;
 return jsonb_build_object('ok',true,'comment_id',v_id);
end $$;

create or replace function public.aam_social_update_avatar(p_token uuid,p_avatar_path text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_path text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 v_path=coalesce(p_avatar_path,'');
 if v_path not like 'avatars/'||v_customer::text||'/%' or v_path like '%..%' then raise exception 'Invalid profile picture'; end if;
 insert into public.aam_social_profiles(customer_id,avatar_path)
 values(v_customer,v_path)
 on conflict(customer_id) do update set avatar_path=excluded.avatar_path,updated_at=now();
 insert into public.aam_social_notifications(recipient_id,actor_id,event_type,title,body)
 select follower_id,v_customer,'profile_update','Profile picture updated','A creator you follow changed their profile picture.'
 from public.aam_social_follows where followed_id=v_customer;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.aam_social_update_profile(
 p_token uuid,p_display_name text,p_bio text,p_is_private boolean,p_comments_enabled boolean
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_name text; v_bio text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 v_name=trim(coalesce(p_display_name,''));
 v_bio=trim(coalesce(p_bio,''));
 if length(v_name)<1 or length(v_name)>40 then raise exception 'Display name must be 1–40 characters'; end if;
 if length(v_bio)>300 then raise exception 'Bio must be 300 characters or less'; end if;
 insert into public.aam_social_profiles(customer_id,display_name,bio,is_private,comments_enabled)
 values(v_customer,v_name,v_bio,coalesce(p_is_private,false),coalesce(p_comments_enabled,true))
 on conflict(customer_id) do update set display_name=excluded.display_name,bio=excluded.bio,
 is_private=excluded.is_private,comments_enabled=excluded.comments_enabled,updated_at=now();
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.aam_social_update_preferences(
 p_token uuid,p_sound integer,p_wallpaper text,p_custom_wallpaper_path text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_wallpaper text; v_path text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if p_sound is null or p_sound<1 or p_sound>15 then raise exception 'Choose a valid notification sound'; end if;
 v_wallpaper=coalesce(p_wallpaper,'default');v_path=nullif(coalesce(p_custom_wallpaper_path,''),'');
 if v_wallpaper<>'default' and v_wallpaper<>'custom' and v_wallpaper !~ '^theme-(0[1-9]|1[0-9]|20)$' then raise exception 'Choose a valid wallpaper'; end if;
 if v_wallpaper='custom' and (v_path is null or v_path not like 'wallpapers/'||v_customer::text||'/%' or v_path like '%..%') then raise exception 'Choose a valid custom wallpaper'; end if;
 insert into public.aam_social_preferences(customer_id,notification_sound,chat_wallpaper,custom_wallpaper_path)
 values(v_customer,p_sound,v_wallpaper,case when v_wallpaper='custom' then v_path else null end)
 on conflict(customer_id) do update set notification_sound=excluded.notification_sound,
 chat_wallpaper=excluded.chat_wallpaper,custom_wallpaper_path=excluded.custom_wallpaper_path,updated_at=now();
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.aam_chat_start(p_token uuid,p_target uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_conversation uuid;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then raise exception 'Confirm that you are 18 or older first'; end if;
 if v_customer=p_target or not exists(select 1 from public.customers where id=p_target) then raise exception 'Choose a valid creator'; end if;
 if exists(select 1 from public.aam_social_profiles where customer_id=p_target and is_private=true) and not exists(select 1 from public.aam_social_follows where follower_id=v_customer and followed_id=p_target) then raise exception 'Follow this private profile before messaging'; end if;
 perform pg_advisory_xact_lock(hashtextextended(least(v_customer::text,p_target::text)||':'||greatest(v_customer::text,p_target::text),0));
 select a.conversation_id into v_conversation
 from public.aam_chat_participants a join public.aam_chat_participants b
 on b.conversation_id=a.conversation_id
 where a.customer_id=v_customer and b.customer_id=p_target limit 1;
 if v_conversation is null then
   insert into public.aam_chat_conversations default values returning id into v_conversation;
   insert into public.aam_chat_participants(conversation_id,customer_id)
   values(v_conversation,v_customer),(v_conversation,p_target);
 end if;
 return jsonb_build_object('conversation_id',v_conversation);
end $$;

create or replace function public.aam_chat_send(
 p_token uuid,p_conversation uuid,p_body text,p_type text,p_media_path text,p_shared_post uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_other uuid; v_id uuid; v_body text; v_type text; v_path text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_chat_participants where conversation_id=p_conversation and customer_id=v_customer) then raise exception 'Conversation not found'; end if;
 select customer_id into v_other from public.aam_chat_participants where conversation_id=p_conversation and customer_id<>v_customer limit 1;
 if v_other is null then raise exception 'Conversation recipient not found'; end if;
 v_type=coalesce(p_type,'text');v_body=coalesce(p_body,'');v_path=nullif(coalesce(p_media_path,''),'');
 if v_type not in ('text','image','video','voice','shared_post') then raise exception 'Unsupported message type'; end if;
 if v_type='text' and length(trim(v_body))=0 then raise exception 'Write a message first'; end if;
 if length(v_body)>5000 then raise exception 'Message is too long'; end if;
 if v_type='voice' and (v_path is null or v_path not like 'voice/'||v_customer::text||'/%') then raise exception 'Invalid voice note'; end if;
 if v_type in ('image','video') and (v_path is null or v_path not like v_customer::text||'/chat/%') then raise exception 'Invalid media attachment'; end if;
 if v_type='shared_post' and (p_shared_post is null or not exists(select 1 from public.aam_social_posts where id=p_shared_post and moderation_status='published')) then raise exception 'Shared post is unavailable'; end if;
 insert into public.aam_chat_messages(conversation_id,sender_id,message_type,body,media_path,shared_post_id)
 values(p_conversation,v_customer,v_type,v_body,v_path,p_shared_post) returning id into v_id;
 update public.aam_chat_conversations set updated_at=now() where id=p_conversation;
 insert into public.aam_social_notifications(recipient_id,actor_id,event_type,title,body,message_id)
 values(v_other,v_customer,case when v_type='shared_post' then 'share' else 'message' end,'New message',case when v_type='voice' then 'Sent a voice note' when v_type='shared_post' then 'Shared a post' when v_type in ('image','video') then 'Sent media' else left(v_body,180) end,v_id);
 return jsonb_build_object('ok',true,'message_id',v_id);
end $$;

create or replace function public.aam_chat_mark_read(p_token uuid,p_conversation uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_count integer;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_chat_participants where conversation_id=p_conversation and customer_id=v_customer) then raise exception 'Conversation not found'; end if;
 insert into public.aam_chat_message_reads(message_id,customer_id)
 select m.id,v_customer from public.aam_chat_messages m
 where m.conversation_id=p_conversation and m.sender_id<>v_customer
 on conflict(message_id,customer_id) do nothing;
 get diagnostics v_count=row_count;
 update public.aam_chat_participants set last_seen_at=now()
 where conversation_id=p_conversation and customer_id=v_customer;
 return jsonb_build_object('ok',true,'marked_read',v_count);
end $$;

create or replace function public.aam_chat_touch(p_token uuid,p_conversation uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 update public.aam_chat_participants set last_seen_at=now()
 where conversation_id=p_conversation and customer_id=v_customer;
 if not found then raise exception 'Conversation not found'; end if;
 return jsonb_build_object('ok',true);
end $$;

revoke all on function public.aam_social_toggle_like(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aam_social_add_comment(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.aam_social_update_avatar(uuid,text) from public,anon,authenticated;
revoke all on function public.aam_social_update_profile(uuid,text,text,boolean,boolean) from public,anon,authenticated;
revoke all on function public.aam_social_update_preferences(uuid,integer,text,text) from public,anon,authenticated;
revoke all on function public.aam_chat_start(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aam_chat_send(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.aam_chat_mark_read(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aam_chat_touch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_social_toggle_like(uuid,uuid) to service_role;
grant execute on function public.aam_social_add_comment(uuid,uuid,text) to service_role;
grant execute on function public.aam_social_update_avatar(uuid,text) to service_role;
grant execute on function public.aam_social_update_profile(uuid,text,text,boolean,boolean) to service_role;
grant execute on function public.aam_social_update_preferences(uuid,integer,text,text) to service_role;
grant execute on function public.aam_chat_start(uuid,uuid) to service_role;
grant execute on function public.aam_chat_send(uuid,uuid,text,text,text,uuid) to service_role;
grant execute on function public.aam_chat_mark_read(uuid,uuid) to service_role;
grant execute on function public.aam_chat_touch(uuid,uuid) to service_role;

-- ===== supabase/migrations/20261118090400_social_notification_preferences.sql =====
-- Per-event social notification preferences for customers.

alter table public.aam_social_preferences add column if not exists profile_update_notifications boolean not null default true;
create or replace function public.aam_social_update_notification_preferences(
 p_token uuid,
 p_profile_views boolean,
 p_follows boolean,
 p_likes boolean,
 p_comments boolean,
 p_shares boolean,
 p_messages boolean,
 p_profile_updates boolean
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_customer uuid;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 insert into public.aam_social_preferences(
  customer_id,profile_view_notifications,follow_notifications,like_notifications,
  comment_notifications,share_notifications,message_notifications,profile_update_notifications
 ) values(
  v_customer,coalesce(p_profile_views,true),coalesce(p_follows,true),coalesce(p_likes,true),
  coalesce(p_comments,true),coalesce(p_shares,true),coalesce(p_messages,true),coalesce(p_profile_updates,true)
 )
 on conflict(customer_id) do update set
  profile_view_notifications=excluded.profile_view_notifications,
  follow_notifications=excluded.follow_notifications,
  like_notifications=excluded.like_notifications,
  comment_notifications=excluded.comment_notifications,
  share_notifications=excluded.share_notifications,
  message_notifications=excluded.message_notifications,
  profile_update_notifications=excluded.profile_update_notifications,
  updated_at=now();
 return jsonb_build_object('saved',true);
end $$;
revoke all on function public.aam_social_update_notification_preferences(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.aam_social_update_notification_preferences(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean) to service_role;

-- ===== supabase/migrations/20261118090500_social_notification_preferences_and_profile_views.sql =====
-- Enforce per-event notification preferences for in-app alerts and count unique profile viewers.

create table if not exists public.aam_social_profile_views (
  profile_key text not null,
  viewer_id uuid not null references public.customers(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key(profile_key,viewer_id),
  constraint aam_social_profile_view_key check (profile_key='admin' or profile_key ~ '^[0-9a-f-]{36}$')
);
create index if not exists aam_social_profile_views_profile_idx
  on public.aam_social_profile_views(profile_key,viewed_at desc);
alter table public.aam_social_profile_views enable row level security;
revoke all on public.aam_social_profile_views from public,anon,authenticated;
grant all on public.aam_social_profile_views to service_role;

create or replace function public.aam_social_filter_notification_preferences()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare v_enabled boolean;
begin
  select case new.event_type
    when 'profile_view' then profile_view_notifications
    when 'follow' then follow_notifications
    when 'like' then like_notifications
    when 'comment' then comment_notifications
    when 'share' then share_notifications
    when 'message' then message_notifications
    when 'profile_update' then profile_update_notifications
    else true
  end into v_enabled
  from public.aam_social_preferences
  where customer_id=new.recipient_id;
  if coalesce(v_enabled,true)=false then return null; end if;
  return new;
end;
$$;
drop trigger if exists aam_social_notification_preference_filter on public.aam_social_notifications;
create trigger aam_social_notification_preference_filter
before insert on public.aam_social_notifications
for each row execute function public.aam_social_filter_notification_preferences();
revoke all on function public.aam_social_filter_notification_preferences() from public,anon,authenticated;
grant execute on function public.aam_social_filter_notification_preferences() to service_role;

-- ===== supabase/migrations/20261118100000_community_group_chat.sql =====
-- All Ads Manager shared community group.
-- Additive migration: existing one-to-one conversations and all payments remain unchanged.

alter table public.aam_chat_conversations
  add column if not exists conversation_type text not null default 'direct'
    check (conversation_type in ('direct','group')),
  add column if not exists title text,
  add column if not exists owner_kind text not null default 'customer'
    check (owner_kind in ('customer','platform_manager')),
  add column if not exists owner_customer_id uuid references public.customers(id) on delete set null;

create table if not exists public.aam_chat_group_members (
  conversation_id uuid not null references public.aam_chat_conversations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  group_role text not null default 'member' check (group_role in ('member','admin')),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, customer_id)
);

alter table public.aam_chat_group_members enable row level security;
revoke all on public.aam_chat_group_members from public, anon, authenticated;
grant all on public.aam_chat_group_members to service_role;

-- One permanent community group, managed by the platform manager.
insert into public.aam_chat_conversations(id,conversation_type,title,owner_kind,owner_customer_id)
values ('a0000000-0000-4000-8000-000000000001','group','All Ads Manager Community','platform_manager',null)
on conflict (id) do update set conversation_type='group',title='All Ads Manager Community',owner_kind='platform_manager',owner_customer_id=null;

-- Provision every existing customer as a member without changing their other chats.
insert into public.aam_chat_participants(conversation_id,customer_id)
select 'a0000000-0000-4000-8000-000000000001'::uuid,c.id
from public.customers c
on conflict (conversation_id,customer_id) do nothing;

insert into public.aam_chat_group_members(conversation_id,customer_id,group_role)
select 'a0000000-0000-4000-8000-000000000001'::uuid,c.id,'member'
from public.customers c
on conflict (conversation_id,customer_id) do nothing;

create or replace function public.aam_chat_provision_community_member()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.aam_chat_participants(conversation_id,customer_id)
  values('a0000000-0000-4000-8000-000000000001'::uuid,new.id)
  on conflict (conversation_id,customer_id) do nothing;
  insert into public.aam_chat_group_members(conversation_id,customer_id,group_role)
  values('a0000000-0000-4000-8000-000000000001'::uuid,new.id,'member')
  on conflict (conversation_id,customer_id) do nothing;
  return new;
end $$;

drop trigger if exists aam_chat_provision_community_member on public.customers;
create trigger aam_chat_provision_community_member
after insert on public.customers
for each row execute function public.aam_chat_provision_community_member();

-- Group messages use the same message/read-receipt records as direct chats.
-- Direct chats retain their existing two-person validation.
create or replace function public.aam_chat_send(
 p_token uuid,p_conversation uuid,p_body text,p_type text,p_media_path text,p_shared_post uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_customer uuid; v_other uuid; v_id uuid; v_body text; v_type text; v_path text;
 v_group boolean; v_recipients integer;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then raise exception 'Confirm that you are 18 or older first'; end if;
 if not exists(select 1 from public.aam_chat_participants where conversation_id=p_conversation and customer_id=v_customer) then raise exception 'Conversation not found'; end if;
 select conversation_type='group' into v_group from public.aam_chat_conversations where id=p_conversation;
 if coalesce(v_group,false) then
   if not exists(select 1 from public.aam_chat_group_members where conversation_id=p_conversation and customer_id=v_customer) then raise exception 'You are not a member of this group'; end if;
 else
   select customer_id into v_other from public.aam_chat_participants where conversation_id=p_conversation and customer_id<>v_customer limit 1;
   if v_other is null then raise exception 'Conversation recipient not found'; end if;
 end if;
 v_type=coalesce(p_type,'text');v_body=coalesce(p_body,'');v_path=nullif(coalesce(p_media_path,''),'');
 if v_type not in ('text','image','video','voice','shared_post') then raise exception 'Unsupported message type'; end if;
 if v_type='text' and length(trim(v_body))=0 then raise exception 'Write a message first'; end if;
 if length(v_body)>5000 then raise exception 'Message is too long'; end if;
 if v_type='voice' and (v_path is null or v_path not like 'voice/'||v_customer::text||'/%') then raise exception 'Invalid voice note'; end if;
 if v_type in ('image','video') and (v_path is null or v_path not like v_customer::text||'/chat/%') then raise exception 'Invalid media attachment'; end if;
 if v_type='shared_post' and (p_shared_post is null or not exists(select 1 from public.aam_social_posts where id=p_shared_post and moderation_status='published')) then raise exception 'Shared post is unavailable'; end if;
 insert into public.aam_chat_messages(conversation_id,sender_id,message_type,body,media_path,shared_post_id)
 values(p_conversation,v_customer,v_type,v_body,v_path,p_shared_post) returning id into v_id;
 update public.aam_chat_conversations set updated_at=now() where id=p_conversation;
 if v_group then
   insert into public.aam_social_notifications(recipient_id,actor_id,event_type,title,body,message_id)
   select gm.customer_id,v_customer,'message','New community message',
     case when v_type='voice' then 'A member sent a voice note' when v_type='shared_post' then 'A member shared a post' when v_type in ('image','video') then 'A member shared media' else left(v_body,180) end,v_id
   from public.aam_chat_group_members gm
   where gm.conversation_id=p_conversation and gm.customer_id<>v_customer;
 else
   insert into public.aam_social_notifications(recipient_id,actor_id,event_type,title,body,message_id)
   values(v_other,v_customer,case when v_type='shared_post' then 'share' else 'message' end,'New message',
     case when v_type='voice' then 'Sent a voice note' when v_type='shared_post' then 'Shared a post' when v_type in ('image','video') then 'Sent media' else left(v_body,180) end,v_id);
 end if;
 return jsonb_build_object('ok',true,'message_id',v_id,'group_message',coalesce(v_group,false));
end $$;

-- Called only by the existing, server-validated platform-admin Netlify endpoint.
create or replace function public.aam_chat_group_set_admin(p_customer_id uuid,p_make_admin boolean)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_group constant uuid := 'a0000000-0000-4000-8000-000000000001'::uuid;
begin
 if not exists(select 1 from public.aam_chat_group_members where conversation_id=v_group and customer_id=p_customer_id) then
   raise exception 'That customer is not a member of the community group';
 end if;
 update public.aam_chat_group_members
 set group_role=case when p_make_admin then 'admin' else 'member' end
 where conversation_id=v_group and customer_id=p_customer_id;
 return jsonb_build_object('ok',true,'customer_id',p_customer_id,'group_role',case when p_make_admin then 'admin' else 'member' end);
end $$;

revoke all on function public.aam_chat_provision_community_member() from public,anon,authenticated;
revoke all on function public.aam_chat_group_set_admin(uuid,boolean) from public,anon,authenticated;
grant execute on function public.aam_chat_group_set_admin(uuid,boolean) to service_role;
grant execute on function public.aam_chat_send(uuid,uuid,text,text,text,uuid) to service_role;

-- ===== supabase/migrations/20261118100100_direct_chat_group_separation.sql =====
-- Keep one-to-one chat lookup separate from the shared community conversation.

create or replace function public.aam_chat_start(p_token uuid,p_target uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_conversation uuid;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then raise exception 'Confirm that you are 18 or older first'; end if;
 if v_customer=p_target or not exists(select 1 from public.customers where id=p_target) then raise exception 'Choose a valid creator'; end if;
 if exists(select 1 from public.aam_social_profiles where customer_id=p_target and is_private=true) and not exists(select 1 from public.aam_social_follows where follower_id=v_customer and followed_id=p_target) then raise exception 'Follow this private profile before messaging'; end if;
 perform pg_advisory_xact_lock(hashtextextended(least(v_customer::text,p_target::text)||':'||greatest(v_customer::text,p_target::text),0));
 select a.conversation_id into v_conversation
 from public.aam_chat_participants a
 join public.aam_chat_participants b on b.conversation_id=a.conversation_id
 join public.aam_chat_conversations c on c.id=a.conversation_id and c.conversation_type='direct'
 where a.customer_id=v_customer and b.customer_id=p_target
 limit 1;
 if v_conversation is null then
   insert into public.aam_chat_conversations(conversation_type) values('direct') returning id into v_conversation;
   insert into public.aam_chat_participants(conversation_id,customer_id)
   values(v_conversation,v_customer),(v_conversation,p_target);
 end if;
 return jsonb_build_object('conversation_id',v_conversation);
end $$;

revoke all on function public.aam_chat_start(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_chat_start(uuid,uuid) to service_role;

-- ===== supabase/migrations/20261118110000_professional_video_only_coin_unlocks.sql =====
-- Correct Professional Video charging: only admin-published videos cost one coin.
-- Customer videos and all pictures remain free. Unlocks are idempotent per customer/video.

create or replace function public.aam_social_unlock_video(p_token uuid,p_post_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_customer uuid;
  v_balance bigint;
  v_post public.aam_social_posts;
  v_unlock public.aam_social_video_unlocks;
begin
  select customer_id into v_customer
  from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_customer is null then raise exception 'Session expired'; end if;

  select * into v_post
  from public.aam_social_posts
  where id=p_post_id and media_type='video' and moderation_status='published';
  if v_post.id is null then raise exception 'Video is unavailable'; end if;

  -- Every customer-published video is free, including videos from other customers.
  if v_post.author_role <> 'admin' then
    if v_post.customer_id is not null
       and exists(select 1 from public.aam_social_profiles where customer_id=v_post.customer_id and is_private=true)
       and v_post.customer_id <> v_customer
       and not exists(select 1 from public.aam_social_follows where follower_id=v_customer and followed_id=v_post.customer_id) then
      raise exception 'This profile is private';
    end if;
    return jsonb_build_object('unlocked',true,'free_video',true,'coins_charged',0);
  end if;

  -- Only Professional Videos published by the platform require age confirmation and one coin.
  if not exists(
    select 1 from public.aam_social_profiles
    where customer_id=v_customer and adult_confirmed_at is not null
  ) then
    raise exception 'Confirm that you are 18 or older to continue';
  end if;

  insert into public.aam_social_video_unlocks(customer_id,post_id)
  values(v_customer,p_post_id)
  on conflict do nothing
  returning * into v_unlock;

  if v_unlock.customer_id is null then
    select balance_coins into v_balance
    from public.aam_coin_balances where customer_id=v_customer;
    return jsonb_build_object(
      'unlocked',true,
      'already_unlocked',true,
      'coins_charged',0,
      'coin_balance',coalesce(v_balance,0)
    );
  end if;

  -- Atomic conditional debit prevents concurrent unlock requests overspending the balance.
  update public.aam_coin_balances
  set balance_coins=balance_coins-1,updated_at=now()
  where customer_id=v_customer and balance_coins>=1
  returning balance_coins into v_balance;

  if not found then raise exception 'Insufficient coins'; end if;

  insert into public.aam_coin_transactions(
    customer_id,reference,transaction_type,amount_coins,description,related_post_id
  )
  values(
    v_customer,
    'video:'||v_customer::text||':'||p_post_id::text,
    'video_view',
    -1,
    'Unlocked a Professional Video',
    p_post_id
  )
  returning id into v_unlock.coin_transaction_id;

  update public.aam_social_video_unlocks
  set coin_transaction_id=v_unlock.coin_transaction_id
  where customer_id=v_customer and post_id=p_post_id;

  return jsonb_build_object(
    'unlocked',true,
    'coin_balance',v_balance,
    'coins_charged',1
  );
end;
$$;

revoke all on function public.aam_social_unlock_video(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_social_unlock_video(uuid,uuid) to service_role;

-- ===== supabase/migrations/20261118130000_admin_selective_video_locking.sql =====
-- Restore optional admin video locks funded by Promotion Coins.
-- One unlock costs 1 coin once per customer per locked admin video.

alter table public.aam_social_posts
  add column if not exists is_locked boolean not null default false;

create table if not exists public.aam_social_video_unlocks (
  customer_id uuid not null references public.customers(id) on delete cascade,
  post_id uuid not null references public.aam_social_posts(id) on delete cascade,
  coins_charged bigint not null default 1 check (coins_charged = 1),
  unlocked_at timestamptz not null default now(),
  primary key (customer_id, post_id)
);
create index if not exists aam_social_video_unlocks_post_idx
  on public.aam_social_video_unlocks(post_id, unlocked_at desc);

alter table public.aam_social_video_unlocks enable row level security;
revoke all on public.aam_social_video_unlocks from public, anon, authenticated;
grant all on public.aam_social_video_unlocks to service_role;

create or replace function public.aam_social_unlock_video(p_token uuid,p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_customer uuid;
  v_post public.aam_social_posts;
  v_balance bigint;
begin
  select customer_id into v_customer
  from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_customer is null then raise exception 'Session expired'; end if;

  select * into v_post
  from public.aam_social_posts
  where id=p_post_id and media_type='video' and moderation_status='published';
  if v_post.id is null then raise exception 'Video is unavailable'; end if;

  if v_post.author_role <> 'admin' or not coalesce(v_post.is_locked,false) then
    return jsonb_build_object('unlocked',true,'free_video',true,'coins_charged',0);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_customer::text||':'||p_post_id::text,0));

  if exists(select 1 from public.aam_social_video_unlocks
            where customer_id=v_customer and post_id=p_post_id) then
    select balance_coins into v_balance from public.aam_coin_balances
    where customer_id=v_customer;
    return jsonb_build_object('unlocked',true,'already_unlocked',true,
      'coins_charged',0,'coin_balance',coalesce(v_balance,0));
  end if;

  update public.aam_coin_balances
  set balance_coins=balance_coins-1,updated_at=now()
  where customer_id=v_customer and balance_coins>=1
  returning balance_coins into v_balance;

  if v_balance is null then raise exception 'Insufficient Promotion Coins'; end if;

  insert into public.aam_social_video_unlocks(customer_id,post_id,coins_charged)
  values(v_customer,p_post_id,1);

  insert into public.aam_coin_transactions(
    customer_id,reference,transaction_type,amount_coins,description,related_post_id
  ) values (
    v_customer,'video_unlock:'||v_customer::text||':'||p_post_id::text,
    'video_view',-1,'Unlocked an administrator video',p_post_id
  );

  return jsonb_build_object('unlocked',true,'already_unlocked',false,
    'coins_charged',1,'coin_balance',v_balance);
end;
$$;

revoke all on function public.aam_social_unlock_video(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_social_unlock_video(uuid,uuid) to service_role;

-- ===== supabase/migrations/20261118150000_one_time_video_earnings_ledger.sql =====
-- All Ads Manager: one-time paid-video unlocks and a separate admin earnings ledger.
-- Repeat views of an already-unlocked video never charge coins again.
-- Additive migration; does not modify the normal cash wallet or Paystack settlement.

create table if not exists public.aam_social_admin_video_earnings (
  id boolean primary key default true check (id = true),
  balance_ngn bigint not null default 0 check (balance_ngn >= 0),
  updated_at timestamptz not null default now()
);

insert into public.aam_social_admin_video_earnings(id, balance_ngn)
values (true, 0)
on conflict (id) do nothing;

create table if not exists public.aam_social_admin_video_earning_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  post_id uuid not null references public.aam_social_posts(id) on delete restrict,
  amount_ngn bigint not null default 1 check (amount_ngn = 1),
  reference text not null unique,
  created_at timestamptz not null default now(),
  unique (customer_id, post_id)
);

create index if not exists aam_social_admin_video_earning_ledger_created_idx
  on public.aam_social_admin_video_earning_ledger(created_at desc);

alter table public.aam_social_admin_video_earnings enable row level security;
alter table public.aam_social_admin_video_earning_ledger enable row level security;
revoke all on public.aam_social_admin_video_earnings from public, anon, authenticated;
revoke all on public.aam_social_admin_video_earning_ledger from public, anon, authenticated;
grant all on public.aam_social_admin_video_earnings to service_role;
grant all on public.aam_social_admin_video_earning_ledger to service_role;

create or replace function public.aam_social_unlock_video(p_token uuid, p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_post public.aam_social_posts;
  v_balance bigint;
  v_unlock_inserted integer;
begin
  select customer_id into v_customer
  from public.customer_sessions
  where token = p_token and expires_at > now();

  if v_customer is null then
    raise exception 'Session expired';
  end if;

  select * into v_post
  from public.aam_social_posts
  where id = p_post_id
    and media_type = 'video'
    and moderation_status = 'published';

  if v_post.id is null then
    raise exception 'Video is unavailable';
  end if;

  -- Every customer-uploaded video is free.
  if v_post.author_role <> 'admin' or not coalesce(v_post.is_locked, false) then
    return jsonb_build_object(
      'unlocked', true,
      'free_video', true,
      'coins_charged', 0
    );
  end if;

  -- Private customer profiles still respect their follow permissions.
  -- Platform-published videos have no customer owner.
  if v_post.customer_id is not null
     and exists (
       select 1 from public.aam_social_profiles
       where customer_id = v_post.customer_id and is_private = true
     )
     and v_post.customer_id <> v_customer
     and not exists (
       select 1 from public.aam_social_follows
       where follower_id = v_customer and followed_id = v_post.customer_id
     ) then
    raise exception 'This profile is private';
  end if;

  -- Serialize simultaneous unlock requests for this customer/video pair.
  perform pg_advisory_xact_lock(
    hashtextextended(v_customer::text || ':' || p_post_id::text, 0)
  );

  if exists (
    select 1 from public.aam_social_video_unlocks
    where customer_id = v_customer and post_id = p_post_id
  ) then
    select balance_coins into v_balance
    from public.aam_coin_balances
    where customer_id = v_customer;

    return jsonb_build_object(
      'unlocked', true,
      'already_unlocked', true,
      'coins_charged', 0,
      'coin_balance', coalesce(v_balance, 0)
    );
  end if;

  update public.aam_coin_balances
  set balance_coins = balance_coins - 1,
      updated_at = now()
  where customer_id = v_customer
    and balance_coins >= 1
  returning balance_coins into v_balance;

  if not found then
    raise exception 'Insufficient Promotion Coins';
  end if;

  insert into public.aam_social_video_unlocks(customer_id, post_id, coins_charged)
  values (v_customer, p_post_id, 1);

  insert into public.aam_coin_transactions(
    customer_id, reference, transaction_type, amount_coins,
    description, related_post_id
  )
  values (
    v_customer,
    'video_unlock:' || v_customer::text || ':' || p_post_id::text,
    'video_view',
    -1,
    'Unlocked a Professional Video',
    p_post_id
  );

  -- Credit the separate admin earnings balance exactly once per successful unlock.
  insert into public.aam_social_admin_video_earning_ledger(
    customer_id, post_id, amount_ngn, reference
  )
  values (
    v_customer,
    p_post_id,
    1,
    'video_earning:' || v_customer::text || ':' || p_post_id::text
  );

  update public.aam_social_admin_video_earnings
  set balance_ngn = balance_ngn + 1,
      updated_at = now()
  where id = true;

  return jsonb_build_object(
    'unlocked', true,
    'already_unlocked', false,
    'coins_charged', 1,
    'coin_balance', v_balance
  );
end;
$$;

revoke all on function public.aam_social_unlock_video(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.aam_social_unlock_video(uuid, uuid)
  to service_role;

-- ===== supabase/migrations/20261119130000_separate_social_coin_balances_and_earnings.sql =====
-- Separate free viewing rewards from real-money purchased coins.
-- Legacy combined balances are preserved as FREE coins; no old balance is
-- silently reclassified as cash-backed without Paystack evidence.

alter table public.aam_social_profiles
  add column if not exists adult_confirmed_at timestamptz;
alter table public.aam_social_posts
  add column if not exists is_locked boolean not null default false;

alter table public.aam_coin_balances
  add column if not exists free_coins bigint not null default 0,
  add column if not exists purchased_coins bigint not null default 0;

update public.aam_coin_balances
set free_coins = balance_coins,
    purchased_coins = 0
where free_coins = 0 and purchased_coins = 0 and balance_coins > 0;

-- Ensure every existing customer has a coin row, including accounts created
-- before the social coin feature was enabled.
insert into public.aam_coin_balances(customer_id,balance_coins,free_coins,purchased_coins)
select c.id,0,0,0 from public.customers c
on conflict(customer_id) do nothing;

alter table public.aam_coin_balances
  drop constraint if exists aam_coin_balances_split_check;
alter table public.aam_coin_balances
  add constraint aam_coin_balances_split_check
  check (balance_coins = free_coins + purchased_coins
         and free_coins >= 0 and purchased_coins >= 0);

create table if not exists public.aam_social_coin_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  reference text not null unique,
  amount_kobo bigint not null check (amount_kobo >= 50000),
  coin_amount bigint not null check (coin_amount >= 500),
  currency text not null default 'NGN' check (currency='NGN'),
  payment_method text not null check (payment_method in ('card','bank_transfer')),
  status text not null default 'pending' check (status in ('pending','paid','failed','initialization_failed')),
  paystack_transaction_id text unique,
  paystack_channel text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists aam_social_coin_payments_paystack_txn_uidx
  on public.aam_social_coin_payments(paystack_transaction_id) where paystack_transaction_id is not null;
create index if not exists aam_social_coin_payments_customer_idx
  on public.aam_social_coin_payments(customer_id,created_at desc);

create table if not exists public.aam_social_video_earnings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  post_id uuid not null references public.aam_social_posts(id) on delete cascade,
  coin_transaction_id uuid not null unique references public.aam_coin_transactions(id) on delete cascade,
  paid_coins_spent bigint not null check (paid_coins_spent > 0),
  amount_naira bigint not null check (amount_naira > 0),
  created_at timestamptz not null default now(),
  unique(customer_id,post_id)
);
alter table public.aam_social_coin_payments enable row level security;
alter table public.aam_social_video_earnings enable row level security;
revoke all on public.aam_social_coin_payments,public.aam_social_video_earnings from public,anon,authenticated;
grant all on public.aam_social_coin_payments,public.aam_social_video_earnings to service_role;

create table if not exists public.aam_social_video_unlocks (
  customer_id uuid not null references public.customers(id) on delete cascade,
  post_id uuid not null references public.aam_social_posts(id) on delete cascade,
  coin_transaction_id uuid unique references public.aam_coin_transactions(id) on delete set null,
  unlocked_at timestamptz not null default now(),
  primary key(customer_id,post_id)
);
alter table public.aam_social_video_unlocks enable row level security;
revoke all on public.aam_social_video_unlocks from public,anon,authenticated;
grant all on public.aam_social_video_unlocks to service_role;

-- Every new customer starts with 30 FREE viewing coins.
create or replace function public.aam_social_initialize_customer()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.aam_social_profiles(customer_id,display_name)
  values(new.id,new.name) on conflict(customer_id) do nothing;
  insert into public.aam_coin_balances(customer_id,balance_coins,free_coins,purchased_coins)
  values(new.id,30,30,0)
  on conflict(customer_id) do nothing;
  insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description)
  values(new.id,'signup:'||new.id::text,'admin_adjustment',30,'30 free starter viewing coins')
  on conflict(reference) do nothing;
  return new;
end;
$$;
drop trigger if exists aam_social_customer_created on public.customers;
create trigger aam_social_customer_created after insert on public.customers
for each row execute function public.aam_social_initialize_customer();
revoke all on function public.aam_social_initialize_customer() from public,anon,authenticated;
grant execute on function public.aam_social_initialize_customer() to service_role;

-- Restore the explicit 18+ confirmation RPC after the earlier age-gate removal migration.
-- Confirmation is stored once per customer and is required by social reward/unlock RPCs.
create or replace function public.aam_social_confirm_age(p_token uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 insert into public.aam_social_profiles(customer_id,adult_confirmed_at)
 values(v_customer,now())
 on conflict(customer_id) do update
   set adult_confirmed_at=coalesce(public.aam_social_profiles.adult_confirmed_at,now());
 return jsonb_build_object('confirmed',true);
end;
$$;
revoke all on function public.aam_social_confirm_age(uuid) from public,anon,authenticated;
grant execute on function public.aam_social_confirm_age(uuid) to service_role;

-- One-time follow rewards: 35 FREE to follower, 60 FREE to followed creator.
create or replace function public.aam_social_follow(p_token uuid,p_target uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_follower uuid; v_inserted integer; v_balance record;
begin
 select customer_id into v_follower from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_follower is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_follower and adult_confirmed_at is not null) then raise exception 'Confirm that you are 18 or older first'; end if;
 if v_follower=p_target then raise exception 'You cannot follow your own profile'; end if;
 if not exists(select 1 from public.customers where id=p_target) then raise exception 'Friend not found'; end if;
 insert into public.aam_social_profiles(customer_id) values(v_follower),(p_target) on conflict(customer_id) do nothing;
 insert into public.aam_social_follows(follower_id,followed_id) values(v_follower,p_target) on conflict do nothing;
 get diagnostics v_inserted=row_count;
 if v_inserted=1 then
   insert into public.aam_coin_balances(customer_id,balance_coins,free_coins,purchased_coins)
   values(v_follower,35,35,0)
   on conflict(customer_id) do update set
     balance_coins=public.aam_coin_balances.balance_coins+35,
     free_coins=public.aam_coin_balances.free_coins+35,updated_at=now();
   insert into public.aam_coin_balances(customer_id,balance_coins,free_coins,purchased_coins)
   values(p_target,60,60,0)
   on conflict(customer_id) do update set
     balance_coins=public.aam_coin_balances.balance_coins+60,
     free_coins=public.aam_coin_balances.free_coins+60,updated_at=now();
   insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description,related_customer_id)
   values
    (v_follower,'follow:'||v_follower::text||':'||p_target::text||':follower','follow_reward_sent',35,'Free reward for following a creator',p_target),
    (p_target,'follow:'||v_follower::text||':'||p_target::text||':followed','follow_reward_received',60,'Free reward for receiving a follower',v_follower)
   on conflict(reference) do nothing;
   insert into public.aam_social_notifications(recipient_id,actor_id,event_type,title,body)
   values(p_target,v_follower,'follow','New follower','Someone followed your profile.');
 end if;
 select * into v_balance from public.aam_coin_balances where customer_id=v_follower;
 return jsonb_build_object('following',true,'new_follow',v_inserted=1,
   'coins_earned',case when v_inserted=1 then 35 else 0 end,
   'free_coins',coalesce(v_balance.free_coins,0),
   'purchased_coins',coalesce(v_balance.purchased_coins,0),
   'coin_balance',coalesce(v_balance.balance_coins,0));
end;
$$;

-- A valid optional referral code rewards the referrer 500 FREE coins once.
create or replace function public.aam_social_apply_referral(p_token uuid,p_referral_code text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_referrer uuid; v_code text; v_inserted integer;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then raise exception 'Confirm that you are 18 or older first'; end if;
 v_code=upper(trim(coalesce(p_referral_code,'')));
 if v_code='' then return jsonb_build_object('applied',false,'reason','no_code'); end if;
 select customer_id into v_referrer from public.aam_social_profiles where referral_code=v_code;
 if v_referrer is null then raise exception 'Referral number not found'; end if;
 if v_referrer=v_customer then raise exception 'You cannot use your own referral number'; end if;
 insert into public.aam_social_referrals(referrer_id,referred_id,referral_code)
 values(v_referrer,v_customer,v_code) on conflict(referred_id) do nothing;
 get diagnostics v_inserted=row_count;
 if v_inserted=1 then
   insert into public.aam_coin_balances(customer_id,balance_coins,free_coins,purchased_coins)
   values(v_referrer,500,500,0)
   on conflict(customer_id) do update set
     balance_coins=public.aam_coin_balances.balance_coins+500,
     free_coins=public.aam_coin_balances.free_coins+500,updated_at=now();
   insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description,related_customer_id)
   values(v_referrer,'referral:'||v_customer::text,'referral_reward',500,'Free referral registration reward',v_customer)
   on conflict(reference) do nothing;
 end if;
 return jsonb_build_object('applied',v_inserted=1,'referrer_reward_coins',case when v_inserted=1 then 500 else 0 end);
end;
$$;

-- Verified Paystack purchase credit. Called only by server-side payment verification.
create or replace function public.aam_social_credit_coin_purchase(
 p_reference text,p_transaction_id text,p_channel text,p_paid_at timestamptz,
 p_amount_kobo bigint,p_currency text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_payment public.aam_social_coin_payments; v_balance bigint;
begin
 select * into v_payment from public.aam_social_coin_payments
 where reference=p_reference for update;
 if not found then raise exception 'Coin payment not found'; end if;
 if v_payment.status='paid' then
   return jsonb_build_object('credited',false,'already_credited',true);
 end if;
 if v_payment.status<>'pending' then
   raise exception 'Coin payment is not pending and cannot be credited';
 end if;
 if p_amount_kobo<>v_payment.amount_kobo or upper(coalesce(p_currency,''))<>'NGN'
   or p_transaction_id is null or p_transaction_id='' then
   raise exception 'Paystack amount or currency does not match this coin order';
 end if;
 update public.aam_coin_balances
 set purchased_coins=purchased_coins+v_payment.coin_amount,
     balance_coins=balance_coins+v_payment.coin_amount,updated_at=now()
 where customer_id=v_payment.customer_id;
 if not found then
   insert into public.aam_coin_balances(customer_id,balance_coins,free_coins,purchased_coins)
   values(v_payment.customer_id,v_payment.coin_amount,0,v_payment.coin_amount);
 end if;
 insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description)
 values(v_payment.customer_id,'purchase:'||p_reference,'coin_purchase',v_payment.coin_amount,
        'Paystack-verified purchased viewing coins')
 on conflict(reference) do nothing;
 update public.aam_social_coin_payments set status='paid',
   paystack_transaction_id=p_transaction_id,paystack_channel=coalesce(p_channel,''),
   paid_at=coalesce(p_paid_at,now())
 where id=v_payment.id;
 select balance_coins into v_balance from public.aam_coin_balances
 where customer_id=v_payment.customer_id;
 return jsonb_build_object('credited',true,'coin_amount',v_payment.coin_amount,'coin_balance',v_balance);
end;
$$;

-- A locked video costs one coin once per customer. Spend MONEY coins first, then FREE coins.
-- Only when a Money Coin is spent is ₦1 added to the admin video-earnings ledger.
create or replace function public.aam_social_unlock_video(p_token uuid,p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_customer uuid; v_post public.aam_social_posts; v_free bigint; v_money bigint;
 v_total bigint; v_paid_spent bigint:=0; v_tx uuid; v_inserted integer;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then
   raise exception 'Confirm that you are 18 or older to continue';
 end if;
 select * into v_post from public.aam_social_posts
 where id=p_post_id and media_type='video' and moderation_status='published';
 if v_post.id is null then raise exception 'Video is unavailable'; end if;
 if v_post.customer_id=v_customer then
   return jsonb_build_object('unlocked',true,'own_video',true,'coins_charged',0);
 end if;
 if v_post.customer_id is not null
   and exists(select 1 from public.aam_social_profiles where customer_id=v_post.customer_id and is_private=true)
   and not exists(select 1 from public.aam_social_follows where follower_id=v_customer and followed_id=v_post.customer_id) then
   raise exception 'This profile is private';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(v_customer::text||':'||p_post_id::text,0));
 if exists(select 1 from public.aam_social_video_unlocks where customer_id=v_customer and post_id=p_post_id) then
   select balance_coins into v_total from public.aam_coin_balances where customer_id=v_customer;
   return jsonb_build_object('unlocked',true,'already_unlocked',true,'coins_charged',0,'coin_balance',coalesce(v_total,0));
 end if;
 select free_coins,purchased_coins into v_free,v_money
 from public.aam_coin_balances where customer_id=v_customer for update;
 if not found or coalesce(v_free,0)+coalesce(v_money,0)<1 then raise exception 'Insufficient coins'; end if;
 if coalesce(v_money,0)>0 then
   v_paid_spent:=1;
   update public.aam_coin_balances set purchased_coins=purchased_coins-1,
     balance_coins=balance_coins-1,updated_at=now() where customer_id=v_customer;
 else
   update public.aam_coin_balances set free_coins=free_coins-1,
     balance_coins=balance_coins-1,updated_at=now() where customer_id=v_customer;
 end if;
 insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description,related_post_id)
 values(v_customer,'video:'||v_customer::text||':'||p_post_id::text,'video_view',-1,
   case when v_paid_spent=1 then 'Video view paid with Money Coin' else 'Video view paid with Free Coin' end,p_post_id)
 returning id into v_tx;
 insert into public.aam_social_video_unlocks(customer_id,post_id,coins_charged,coin_transaction_id)
 values(v_customer,p_post_id,1,v_tx);
 if v_paid_spent=1 then
   insert into public.aam_social_video_earnings(customer_id,post_id,coin_transaction_id,paid_coins_spent,amount_naira)
   values(v_customer,p_post_id,v_tx,1,1);
   insert into public.aam_social_admin_video_earning_ledger(customer_id,post_id,amount_ngn,reference)
   values(v_customer,p_post_id,1,'video_earning:'||v_customer::text||':'||p_post_id::text);
   update public.aam_social_admin_video_earnings
   set balance_ngn=balance_ngn+1,updated_at=now() where id=true;
 end if;
 select balance_coins into v_total from public.aam_coin_balances where customer_id=v_customer;
 return jsonb_build_object('unlocked',true,'coin_balance',v_total,
  'free_coin_spent',1-v_paid_spent,'money_coin_spent',v_paid_spent,
  'admin_earnings_naira',v_paid_spent);
end;
$$;

revoke all on function public.aam_social_follow(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aam_social_apply_referral(uuid,text) from public,anon,authenticated;
revoke all on function public.aam_social_unlock_video(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aam_social_credit_coin_purchase(text,text,text,timestamptz,bigint,text) from public,anon,authenticated;
grant execute on function public.aam_social_follow(uuid,uuid) to service_role;
grant execute on function public.aam_social_apply_referral(uuid,text) to service_role;
grant execute on function public.aam_social_unlock_video(uuid,uuid) to service_role;
grant execute on function public.aam_social_credit_coin_purchase(text,text,text,timestamptz,bigint,text) to service_role;

-- ===== supabase/migrations/20261119160000_manager_promotion_campaigns.sql =====
-- Manager Promotion: campaign drafts and Money-Coin-only payment.
-- Campaigns remain queued until an administrator connects/approves the advertising provider.

create table if not exists public.aam_social_promotions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  promotion_type text not null check (promotion_type in
    ('viral_profile','viral_video','photo','relationship','business','music','follower_growth')),
  title text not null check (char_length(title) between 3 and 100),
  description text not null check (char_length(description) between 5 and 2000),
  media_path text not null,
  destination_url text,
  requested_days integer not null default 7 check (requested_days between 1 and 90),
  price_coins bigint check (price_coins is null or price_coins > 0),
  status text not null default 'pending_review' check (status in
    ('pending_review','awaiting_payment','paid_provider_pending','active','paused','rejected','completed')),
  provider_status text not null default 'not_connected' check (provider_status in
    ('not_connected','awaiting_partner_access','ready','submitted','running','failed')),
  admin_note text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aam_social_promotions_customer_idx
  on public.aam_social_promotions(customer_id,created_at desc);
create index if not exists aam_social_promotions_status_idx
  on public.aam_social_promotions(status,created_at desc);

create table if not exists public.aam_social_promotion_transactions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.aam_social_promotions(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete cascade,
  money_coins_spent bigint not null check (money_coins_spent > 0),
  amount_naira bigint not null check (amount_naira = money_coins_spent),
  created_at timestamptz not null default now(),
  unique(promotion_id)
);

alter table public.aam_social_promotions enable row level security;

-- Extend the existing immutable coin ledger with a distinct promotion debit.
alter table public.aam_coin_transactions drop constraint if exists aam_coin_transactions_transaction_type_check;
alter table public.aam_coin_transactions add constraint aam_coin_transactions_transaction_type_check
  check (transaction_type in ('follow_reward_sent','follow_reward_received','referral_reward','video_view','coin_purchase','admin_adjustment','promotion_payment','call_avatar_purchase'));
alter table public.aam_social_promotion_transactions enable row level security;
revoke all on public.aam_social_promotions,public.aam_social_promotion_transactions from public,anon,authenticated;
grant all on public.aam_social_promotions,public.aam_social_promotion_transactions to service_role;

-- Customer submits a promotion brief. No coins are deducted at this stage:
-- admin/provider pricing must be confirmed before the customer accepts payment.
create or replace function public.aam_social_promotion_create(
  p_token uuid,promotion_type text,p_title text,p_description text,
  p_media_path text,p_destination_url text,p_requested_days integer
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_id uuid; v_type text; v_title text; v_description text; v_path text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then
   raise exception 'Confirm that you are 18 or older to continue';
 end if;
 v_type=lower(trim(coalesce(promotion_type,'')));
 if v_type not in ('viral_profile','viral_video','photo','relationship','business','music','follower_growth') then
   raise exception 'Choose a valid Manager Promotion type';
 end if;
 v_title=trim(coalesce(p_title,'')); v_description=trim(coalesce(p_description,'')); v_path=trim(coalesce(p_media_path,''));
 if char_length(v_title) not between 3 and 100 then raise exception 'Enter an advert title between 3 and 100 characters'; end if;
 if char_length(v_description) not between 5 and 2000 then raise exception 'Enter an advert description'; end if;
 if v_path not like 'promotions/'||v_customer::text||'/%' or position('..' in v_path)>0 then
   raise exception 'Upload the promotion picture using the secure upload control';
 end if;
 if coalesce(p_requested_days,0) not between 1 and 90 then raise exception 'Choose a duration from 1 to 90 days'; end if;
 insert into public.aam_social_promotions(customer_id,promotion_type,title,description,media_path,destination_url,requested_days)
 values(v_customer,v_type,v_title,v_description,v_path,nullif(trim(coalesce(p_destination_url,'')),''),p_requested_days)
 returning id into v_id;
 return jsonb_build_object('created',true,'promotion_id',v_id,'status','pending_review',
   'message','Your promotion brief was submitted for review. No coins have been deducted.');
end;
$$;

-- Customer can pay only after an administrator sets the approved coin price.
-- The RPC deducts purchased/Money Coins only; Free Coins are never eligible.
create or replace function public.aam_social_promotion_pay(p_token uuid,p_promotion_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_p public.aam_social_promotions; v_money bigint;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 select * into v_p from public.aam_social_promotions
 where id=p_promotion_id and customer_id=v_customer for update;
 if v_p.id is null then raise exception 'Promotion not found'; end if;
 if v_p.status<>'awaiting_payment' or v_p.provider_status<>'ready' or v_p.price_coins is null or v_p.price_coins<1 then
   raise exception 'This promotion is not priced and ready for payment yet';
 end if;
 if exists(select 1 from public.aam_social_promotion_transactions where promotion_id=v_p.id) then
   return jsonb_build_object('paid',true,'already_paid',true,'status',v_p.status);
 end if;
 select purchased_coins into v_money from public.aam_coin_balances
 where customer_id=v_customer for update;
 if coalesce(v_money,0)<v_p.price_coins then
   raise exception 'Insufficient Money Coins. Free Coins cannot be used for promotion. Please buy Money Coins.';
 end if;
 update public.aam_coin_balances
 set purchased_coins=purchased_coins-v_p.price_coins,
     balance_coins=balance_coins-v_p.price_coins,updated_at=now()
 where customer_id=v_customer;
 insert into public.aam_social_promotion_transactions(promotion_id,customer_id,money_coins_spent,amount_naira)
 values(v_p.id,v_customer,v_p.price_coins,v_p.price_coins);
 insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description)
 values(v_customer,'promotion:'||v_p.id::text,'promotion_payment',-v_p.price_coins,
   'Manager Promotion payment with Money Coins')
 on conflict(reference) do nothing;
 update public.aam_social_promotions set status='paid_provider_pending',
   paid_at=now(),updated_at=now()
 where id=v_p.id;
 return jsonb_build_object('paid',true,'money_coins_spent',v_p.price_coins,
   'naira_spent',v_p.price_coins,'status','paid_provider_pending',
   'message','Payment recorded. Promotion will not run until provider access and campaign approval are complete.');
end;
$$;

revoke all on function public.aam_social_promotion_create(uuid,text,text,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.aam_social_promotion_pay(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_social_promotion_create(uuid,text,text,text,text,text,integer) to service_role;
grant execute on function public.aam_social_promotion_pay(uuid,uuid) to service_role;

-- ===== LiveKit calls and photo-avatar setup =====
-- All Ads Manager: complete LiveKit calling and photo-avatar database setup
-- Run this single script once in Supabase SQL Editor before enabling calling/avatar purchases.
-- Consolidated, reviewed migration set; existing login, session, wallet and email sender setup remain intact.
-- It includes one-active-call safeguards and the 1,500 purchased-Money-Coin photo-avatar charge.

-- Required dependency check: the social coin migrations must already be applied.
DO $aam$
BEGIN
  IF to_regclass('public.aam_coin_balances') IS NULL
     OR to_regclass('public.aam_coin_transactions') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'aam_coin_balances' AND column_name = 'purchased_coins'
     ) THEN
    RAISE EXCEPTION 'Apply the All Ads Manager social coin-balance migrations before running this calling setup.';
  END IF;
END;
$aam$;

-- SECTION 1: supabase/migrations/20261119100000_livekit_call_tables.sql
-- Call records used to authorize LiveKit room tokens and track invitations.

create table if not exists public.aam_calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references public.customers(id) on delete cascade,
  call_type text not null check (call_type in ('audio','video')),
  status text not null default 'active' check (status in ('active','ended','missed','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.aam_call_participants (
  call_id uuid not null references public.aam_calls(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  role text not null check (role in ('caller','callee')),
  status text not null default 'invited' check (status in ('invited','accepted','declined','ended')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (call_id, customer_id)
);

create index if not exists aam_call_participants_customer_status_idx
  on public.aam_call_participants(customer_id, status, invited_at desc);
create index if not exists aam_calls_status_created_idx
  on public.aam_calls(status, created_at desc);

alter table public.aam_calls enable row level security;
alter table public.aam_call_participants enable row level security;

revoke all on public.aam_calls from anon, authenticated;
revoke all on public.aam_call_participants from anon, authenticated;
grant all on public.aam_calls to service_role;
grant all on public.aam_call_participants to service_role;

-- SECTION 2: supabase/migrations/20261119190000_admin_livekit_call_identity.sql
-- Permit secure administrator-originated calls without impersonating a customer.

alter table public.aam_calls alter column caller_id drop not null;
alter table public.aam_calls
  add column if not exists caller_role text not null default 'customer',
  add column if not exists admin_session_hash text;
alter table public.aam_calls
  drop constraint if exists aam_calls_caller_identity_check;
alter table public.aam_calls
  add constraint aam_calls_caller_identity_check
  check (
    (caller_role = 'customer' and caller_id is not null and admin_session_hash is null)
    or
    (caller_role = 'admin' and caller_id is null and admin_session_hash is not null)
  );
create index if not exists aam_calls_admin_session_active_idx
  on public.aam_calls(admin_session_hash, status)
  where caller_role = 'admin';

-- Refuse to create the uniqueness guard if legacy data contains overlapping active calls.
DO $aam$
BEGIN
 IF EXISTS (
   SELECT 1 FROM public.aam_call_participants p
   JOIN public.aam_calls c ON c.id=p.call_id
   WHERE c.status='active' AND p.status IN ('invited','accepted')
   GROUP BY p.customer_id HAVING count(*)>1
 ) THEN
   RAISE EXCEPTION 'Multiple active calls already exist for a customer. No calls were changed. Resolve these duplicate active calls before rerunning this setup.';
 END IF;
END $aam$;
create unique index if not exists aam_call_participants_one_active_call_per_customer_idx
 on public.aam_call_participants(customer_id) where status in ('invited','accepted');

-- Refuse duplicate active calls for the same admin session; never end an existing call.
DO $aam$
BEGIN
 IF EXISTS (
   SELECT 1 FROM public.aam_calls
   WHERE caller_role='admin' AND status='active' AND admin_session_hash IS NOT NULL
   GROUP BY admin_session_hash HAVING count(*)>1
 ) THEN
   RAISE EXCEPTION 'Multiple active calls already exist for an administrator session. No calls were changed. Resolve duplicates before rerunning this setup.';
 END IF;
END $aam$;
create unique index if not exists aam_calls_one_active_call_per_admin_idx
 on public.aam_calls(admin_session_hash)
 where caller_role='admin' and status='active' and admin_session_hash is not null;

-- SECTION 5: supabase/migrations/20261119220000_livekit_photo_avatar_coin_charge.sql
-- Charge customers only purchased Money Coins for their own photo avatar during a video call.
-- Administrator-created avatars remain free. One purchase per customer per call permits avatar switching.

create table if not exists public.aam_call_avatar_purchases (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.aam_calls(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  coin_transaction_id uuid not null unique references public.aam_coin_transactions(id),
  amount_coins bigint not null default 1500 check (amount_coins = 1500),
  created_at timestamptz not null default now(),
  unique(call_id, customer_id)
);
alter table public.aam_call_avatar_purchases enable row level security;
revoke all on public.aam_call_avatar_purchases from public, anon, authenticated;
grant all on public.aam_call_avatar_purchases to service_role;

alter table public.aam_coin_transactions
  drop constraint if exists aam_coin_transactions_transaction_type_check;
alter table public.aam_coin_transactions
  add constraint aam_coin_transactions_transaction_type_check
  check (transaction_type in (
    'follow_reward_sent','follow_reward_received','referral_reward','video_view',
    'coin_purchase','admin_adjustment','promotion_payment','call_avatar_purchase'
  ));

create or replace function public.aam_social_charge_call_avatar(p_token uuid, p_call_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_balance bigint;
  v_transaction uuid;
begin
  select customer_id into v_customer
  from public.customer_sessions
  where token = p_token and expires_at > now();

  if v_customer is null then
    raise exception 'Session expired. Please log in again.';
  end if;

  if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then
    raise exception 'Confirm that you are 18 or older first';
  end if;

  perform 1
  from public.aam_calls c
  join public.aam_call_participants p on p.call_id = c.id
  where c.id = p_call_id
    and c.status = 'active'
    and c.call_type = 'video'
    and p.customer_id = v_customer
    and p.status = 'accepted'
  for update of c;

  if not found then
    raise exception 'A photo avatar can only be added during your active video call.';
  end if;

  if exists (
    select 1 from public.aam_call_avatar_purchases
    where call_id = p_call_id and customer_id = v_customer
  ) then
    return jsonb_build_object('paid', true, 'already_paid', true, 'coins_charged', 0);
  end if;

  select purchased_coins into v_balance
  from public.aam_coin_balances
  where customer_id = v_customer
  for update;

  if coalesce(v_balance, 0) < 1500 then
    raise exception 'Insufficient Money Coins. You need 1,500 purchased Money Coins to add your photo avatar.';
  end if;

  update public.aam_coin_balances
  set purchased_coins = purchased_coins - 1500,
      balance_coins = balance_coins - 1500,
      updated_at = now()
  where customer_id = v_customer;

  insert into public.aam_coin_transactions(
    customer_id, reference, transaction_type, amount_coins, description
  ) values (
    v_customer,
    'call-avatar:' || p_call_id::text || ':' || v_customer::text,
    'call_avatar_purchase',
    -1500,
    'Photo avatar during video call'
  ) returning id into v_transaction;

  insert into public.aam_call_avatar_purchases(call_id, customer_id, coin_transaction_id)
  values (p_call_id, v_customer, v_transaction);

  select purchased_coins into v_balance
  from public.aam_coin_balances
  where customer_id = v_customer;

  return jsonb_build_object(
    'paid', true,
    'already_paid', false,
    'coins_charged', 1500,
    'purchased_coins', v_balance
  );
end;
$$;

revoke all on function public.aam_social_charge_call_avatar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.aam_social_charge_call_avatar(uuid, uuid) to service_role;

COMMIT;
