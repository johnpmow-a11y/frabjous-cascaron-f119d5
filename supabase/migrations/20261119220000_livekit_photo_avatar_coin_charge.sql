-- Charge customers only purchased Money Coins for their own photo avatar during a video call.
-- Administrator-created avatars remain free. One purchase per customer per call permits avatar switching.
begin;

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
