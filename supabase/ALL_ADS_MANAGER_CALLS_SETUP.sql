-- All Ads Manager: complete LiveKit calling and photo-avatar database setup
-- Run this single script once in Supabase SQL Editor before enabling calling/avatar purchases.
-- Combines the five ordered migrations in one transaction.
-- It includes one-active-call safeguards and the 1,500 purchased-Money-Coin photo-avatar charge.

begin;

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

-- SECTION 3: supabase/migrations/20261119200000_livekit_one_active_call_per_customer.sql
-- Enforce one active call per customer even when two devices tap Call at once.

-- Repair stale participant rows left by earlier terminal calls.
update public.aam_call_participants p
set status = 'ended'
from public.aam_calls c
where c.id = p.call_id
  and c.status <> 'active'
  and p.status in ('invited', 'accepted');

-- If earlier versions or concurrent requests created overlapping active calls,
-- keep the newest call for each customer and close their older participation.
with ranked as (
  select
    p.call_id,
    p.customer_id,
    row_number() over (
      partition by p.customer_id
      order by c.created_at desc, p.invited_at desc, p.call_id desc
    ) as position
  from public.aam_call_participants p
  join public.aam_calls c on c.id = p.call_id
  where c.status = 'active'
    and p.status in ('invited', 'accepted')
)
update public.aam_call_participants p
set status = 'ended'
from ranked r
where r.position > 1
  and p.call_id = r.call_id
  and p.customer_id = r.customer_id
  and p.status in ('invited', 'accepted');

-- Close customer calls that no longer have both participants, and admin calls
-- whose customer participant was removed during overlap repair.
update public.aam_calls c
set status = 'ended',
    ended_at = coalesce(c.ended_at, now()),
    updated_at = now()
where c.status = 'active'
  and (
    (c.caller_role = 'customer' and (
      select count(*) from public.aam_call_participants p
      where p.call_id = c.id and p.status in ('invited', 'accepted')
    ) < 2)
    or
    (c.caller_role = 'admin' and not exists (
      select 1 from public.aam_call_participants p
      where p.call_id = c.id and p.status in ('invited', 'accepted')
    ))
  );

update public.aam_call_participants p
set status = 'ended'
from public.aam_calls c
where c.id = p.call_id
  and c.status <> 'active'
  and p.status in ('invited', 'accepted');

create unique index if not exists aam_call_participants_one_active_call_per_customer_idx
  on public.aam_call_participants(customer_id)
  where status in ('invited', 'accepted');

-- SECTION 4: supabase/migrations/20261119210000_livekit_one_active_call_per_admin.sql
-- Prevent one administrator session from starting overlapping calls
-- from multiple devices at the same time.

with ranked as (
  select
    id,
    row_number() over (
      partition by admin_session_hash
      order by created_at desc, id desc
    ) as position
  from public.aam_calls
  where caller_role = 'admin'
    and status = 'active'
    and admin_session_hash is not null
)
update public.aam_calls c
set status = 'ended',
    ended_at = coalesce(c.ended_at, now()),
    updated_at = now()
from ranked r
where r.id = c.id
  and r.position > 1;

update public.aam_call_participants p
set status = 'ended'
from public.aam_calls c
where c.id = p.call_id
  and c.caller_role = 'admin'
  and c.status <> 'active'
  and p.status in ('invited', 'accepted');

create unique index if not exists aam_calls_one_active_call_per_admin_idx
  on public.aam_calls(admin_session_hash)
  where caller_role = 'admin'
    and status = 'active'
    and admin_session_hash is not null;

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

commit;
