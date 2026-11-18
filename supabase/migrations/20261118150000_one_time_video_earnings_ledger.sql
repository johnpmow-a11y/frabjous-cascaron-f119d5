-- All Ads Manager: one-time paid-video unlocks and a separate admin earnings ledger.
-- Repeat views of an already-unlocked video never charge coins again.
-- Additive migration; does not modify the normal cash wallet or Paystack settlement.

begin;

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

commit;
