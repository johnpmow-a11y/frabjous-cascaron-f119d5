-- All Ads Manager: separate free viewing rewards from purchased, cash-backed coins.
-- Legacy combined balances are conservatively classified as FREE; no historical cash is invented.
begin;

alter table public.aam_coin_balances
  add column if not exists free_coins bigint not null default 0,
  add column if not exists purchased_coins bigint not null default 0;

update public.aam_coin_balances
set free_coins = greatest(coalesce(balance_coins,0),0),
    purchased_coins = 0
where free_coins = 0 and purchased_coins = 0 and coalesce(balance_coins,0) > 0;

alter table public.aam_coin_balances
  drop constraint if exists aam_coin_balances_free_coins_check,
  drop constraint if exists aam_coin_balances_purchased_coins_check,
  add constraint aam_coin_balances_free_coins_check check (free_coins >= 0),
  add constraint aam_coin_balances_purchased_coins_check check (purchased_coins >= 0);

create or replace function public.aam_coin_balance_sync()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.balance_coins := new.free_coins + new.purchased_coins;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists aam_coin_balance_sync_trigger on public.aam_coin_balances;
create trigger aam_coin_balance_sync_trigger before insert or update of free_coins,purchased_coins
on public.aam_coin_balances for each row execute function public.aam_coin_balance_sync();

-- Historical combined balances stay usable as free viewing coins, never as cash-backed coins.
update public.aam_coin_balances set balance_coins=free_coins+purchased_coins;

alter table public.aam_coin_transactions
  drop constraint if exists aam_coin_transactions_transaction_type_check;
alter table public.aam_coin_transactions
  add constraint aam_coin_transactions_transaction_type_check check (transaction_type in
    ('signup_reward','follow_reward_sent','follow_reward_received','referral_reward',
     'video_view','video_view_paid','video_view_free','coin_purchase','admin_adjustment'));

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

create table if not exists public.aam_coin_cash_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  post_id uuid not null references public.aam_social_posts(id) on delete cascade,
  coin_transaction_id uuid not null unique references public.aam_coin_transactions(id) on delete restrict,
  amount_kobo bigint not null check(amount_kobo > 0),
  source text not null check(source='purchased_coin_video_view'),
  created_at timestamptz not null default now()
);
create index if not exists aam_coin_cash_ledger_created_idx on public.aam_coin_cash_ledger(created_at desc);
alter table public.aam_coin_cash_ledger enable row level security;
revoke all on public.aam_coin_cash_ledger from public,anon,authenticated;
grant all on public.aam_coin_cash_ledger to service_role;

create or replace function public.aam_social_initialize_customer()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.aam_social_profiles(customer_id,display_name)
  values(new.id,new.name) on conflict(customer_id) do nothing;
  insert into public.aam_coin_balances(customer_id,free_coins,purchased_coins)
  values(new.id,10,0)
  on conflict(customer_id) do nothing;
  insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description)
  values(new.id,'signup:'||new.id::text,'signup_reward',10,'10 free coins for creating an account')
  on conflict(reference) do nothing;
  return new;
end;
$$;
drop trigger if exists aam_social_customer_created on public.customers;
create trigger aam_social_customer_created after insert on public.customers
for each row execute function public.aam_social_initialize_customer();
revoke all on function public.aam_social_initialize_customer() from public,anon,authenticated;
grant execute on function public.aam_social_initialize_customer() to service_role;

create or replace function public.aam_social_follow(p_token uuid,p_target uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_follower uuid; v_inserted integer; v_free bigint;
begin
  select customer_id into v_follower from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_follower is null then raise exception 'Session expired'; end if;
  if v_follower=p_target then raise exception 'You cannot follow your own profile'; end if;
  if not exists(select 1 from public.customers where id=p_target) then raise exception 'Friend not found'; end if;
  insert into public.aam_social_profiles(customer_id) values(v_follower),(p_target) on conflict(customer_id) do nothing;
  insert into public.aam_social_follows(follower_id,followed_id) values(v_follower,p_target) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=1 then
    insert into public.aam_coin_balances(customer_id,free_coins,purchased_coins)
      values(v_follower,35,0) on conflict(customer_id) do update
      set free_coins=public.aam_coin_balances.free_coins+35;
    insert into public.aam_coin_balances(customer_id,free_coins,purchased_coins)
      values(p_target,60,0) on conflict(customer_id) do update
      set free_coins=public.aam_coin_balances.free_coins+60;
    insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description,related_customer_id)
    values
      (v_follower,'follow:'||v_follower::text||':'||p_target::text||':follower','follow_reward_sent',35,'Free reward for following a friend',p_target),
      (p_target,'follow:'||v_follower::text||':'||p_target::text||':followed','follow_reward_received',60,'Free reward for receiving a new follower',v_follower)
    on conflict(reference) do nothing;
    insert into public.aam_social_notifications(recipient_id,actor_id,event_type,title,body)
    values(p_target,v_follower,'follow','New follower','Someone followed your profile.');
  end if;
  select free_coins into v_free from public.aam_coin_balances where customer_id=v_follower;
  return jsonb_build_object('following',true,'new_follow',v_inserted=1,'coins_earned',case when v_inserted=1 then 35 else 0 end,'free_coin_balance',coalesce(v_free,0));
end;
$$;

create or replace function public.aam_social_apply_referral(p_token uuid,p_referral_code text)
returns jsonb language plpgsql security definer set search_path = ''
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
    insert into public.aam_coin_balances(customer_id,free_coins,purchased_coins)
    values(v_referrer,500,0) on conflict(customer_id) do update
    set free_coins=public.aam_coin_balances.free_coins+500;
    insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description,related_customer_id)
    values(v_referrer,'referral:'||v_customer::text,'referral_reward',500,'Free referral registration reward',v_customer)
    on conflict(reference) do nothing;
  end if;
  return jsonb_build_object('applied',v_inserted=1,'referrer_reward_coins',case when v_inserted=1 then 500 else 0 end);
end;
$$;

create or replace function public.aam_social_unlock_video(p_token uuid,p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_customer uuid; v_post public.aam_social_posts; v_unlock public.aam_social_video_unlocks;
  v_free bigint; v_paid bigint; v_tx uuid; v_source text; v_remaining_free bigint; v_remaining_paid bigint;
begin
  select customer_id into v_customer from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_customer is null then raise exception 'Session expired'; end if;
  select * into v_post from public.aam_social_posts
  where id=p_post_id and media_type='video' and moderation_status='published';
  if v_post.id is null then raise exception 'Video is unavailable'; end if;
  if v_post.customer_id=v_customer then
    return jsonb_build_object('unlocked',true,'own_video',true,'coins_charged',0);
  end if;
  if v_post.customer_id is not null and exists(
    select 1 from public.aam_social_profiles where customer_id=v_post.customer_id and is_private=true
  ) and not exists(select 1 from public.aam_social_follows where follower_id=v_customer and followed_id=v_post.customer_id) then
    raise exception 'This profile is private';
  end if;
  insert into public.aam_social_video_unlocks(customer_id,post_id)
  values(v_customer,p_post_id) on conflict do nothing returning * into v_unlock;
  if v_unlock.customer_id is null then
    select free_coins,purchased_coins into v_free,v_paid from public.aam_coin_balances where customer_id=v_customer;
    return jsonb_build_object('unlocked',true,'already_unlocked',true,'coins_charged',0,'free_coin_balance',coalesce(v_free,0),'purchased_coin_balance',coalesce(v_paid,0));
  end if;
  select free_coins,purchased_coins into v_free,v_paid
  from public.aam_coin_balances where customer_id=v_customer for update;
  if coalesce(v_free,0)>0 then
    v_source='free';
    update public.aam_coin_balances set free_coins=free_coins-1 where customer_id=v_customer
    returning free_coins,purchased_coins into v_remaining_free,v_remaining_paid;
  elsif coalesce(v_paid,0)>0 then
    v_source='purchased';
    update public.aam_coin_balances set purchased_coins=purchased_coins-1 where customer_id=v_customer
    returning free_coins,purchased_coins into v_remaining_free,v_remaining_paid;
  else
    delete from public.aam_social_video_unlocks where customer_id=v_customer and post_id=p_post_id;
    raise exception 'Insufficient coins';
  end if;
  insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description,related_post_id)
  values(v_customer,'video:'||v_customer::text||':'||p_post_id::text,case when v_source='purchased' then 'video_view_paid' else 'video_view_free' end,-1,
    case when v_source='purchased' then 'Video view paid with purchased coin' else 'Video view paid with free reward coin' end,p_post_id)
  returning id into v_tx;
  update public.aam_social_video_unlocks set coin_transaction_id=v_tx
  where customer_id=v_customer and post_id=p_post_id;
  if v_source='purchased' then
    insert into public.aam_coin_cash_ledger(customer_id,post_id,coin_transaction_id,amount_kobo,source)
    values(v_customer,p_post_id,v_tx,100,'purchased_coin_video_view');
  end if;
  return jsonb_build_object('unlocked',true,'coins_charged',1,'coin_source',v_source,
    'free_coin_balance',v_remaining_free,'purchased_coin_balance',v_remaining_paid);
end;
$$;

revoke all on function public.aam_social_follow(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aam_social_apply_referral(uuid,text) from public,anon,authenticated;
revoke all on function public.aam_social_unlock_video(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_social_follow(uuid,uuid) to service_role;
grant execute on function public.aam_social_apply_referral(uuid,text) to service_role;
grant execute on function public.aam_social_unlock_video(uuid,uuid) to service_role;

commit;
