-- Separate free viewing rewards from real-money purchased coins.
-- Legacy combined balances are preserved as FREE coins; no old balance is
-- silently reclassified as cash-backed without Paystack evidence.
begin;

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

-- Every new customer starts with 10 FREE viewing coins.
create or replace function public.aam_social_initialize_customer()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.aam_social_profiles(customer_id,display_name)
  values(new.id,new.name) on conflict(customer_id) do nothing;
  insert into public.aam_coin_balances(customer_id,balance_coins,free_coins,purchased_coins)
  values(new.id,10,10,0)
  on conflict(customer_id) do nothing;
  insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description)
  values(new.id,'signup:'||new.id::text,'admin_adjustment',10,'10 free starter viewing coins')
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
as $
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
$;
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

-- A locked video costs one coin once per customer. Spend FREE coins first.
-- Only when a purchased coin is spent is ₦1 added to the admin video-earnings ledger.
create or replace function public.aam_social_unlock_video(p_token uuid,p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_post public.aam_social_posts; v_unlock public.aam_social_video_unlocks;
        v_free bigint; v_paid bigint; v_total bigint; v_paid_spent bigint:=0; v_tx uuid;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then raise exception 'Confirm that you are 18 or older to continue'; end if;
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
 -- API-sourced and customer-published videos are free. Only administrator-marked videos are paid.
 if v_post.author_role <> 'admin' or not coalesce(v_post.is_locked,false) then
   return jsonb_build_object('unlocked',true,'free_video',true,'coins_charged',0);
 end if;
 -- A locked administrator video costs one coin once per customer/video.
 insert into public.aam_social_video_unlocks(customer_id,post_id)
 values(v_customer,p_post_id) on conflict do nothing returning * into v_unlock;
 if v_unlock.customer_id is null then
   select balance_coins into v_total from public.aam_coin_balances where customer_id=v_customer;
   return jsonb_build_object('unlocked',true,'already_unlocked',true,'coins_charged',0,'coin_balance',coalesce(v_total,0));
 end if;
 select free_coins,purchased_coins into v_free,v_paid
 from public.aam_coin_balances where customer_id=v_customer for update;
 if coalesce(v_free,0)+coalesce(v_paid,0)<1 then
   delete from public.aam_social_video_unlocks where customer_id=v_customer and post_id=p_post_id;
   raise exception 'Insufficient coins';
 end if;
 if coalesce(v_free,0)>0 then
   update public.aam_coin_balances set free_coins=free_coins-1,
     balance_coins=balance_coins-1,updated_at=now()
   where customer_id=v_customer;
 else
   v_paid_spent:=1;
   update public.aam_coin_balances set purchased_coins=purchased_coins-1,
     balance_coins=balance_coins-1,updated_at=now()
   where customer_id=v_customer;
 end if;
 insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description,related_post_id)
 values(v_customer,'video:'||v_customer::text||':'||p_post_id::text,'video_view',-1,
   case when v_paid_spent=1 then 'Unlocked locked video with purchased coin' else 'Unlocked locked video with free coin' end,p_post_id)
 returning id into v_tx;
 update public.aam_social_video_unlocks set coin_transaction_id=v_tx
 where customer_id=v_customer and post_id=p_post_id;
 if v_paid_spent=1 then
   insert into public.aam_social_video_earnings(customer_id,post_id,coin_transaction_id,paid_coins_spent,amount_naira)
   values(v_customer,p_post_id,v_tx,1,1)
   on conflict(customer_id,post_id) do nothing;
 end if;
 select balance_coins into v_total from public.aam_coin_balances where customer_id=v_customer;
 return jsonb_build_object('unlocked',true,'coin_balance',v_total,
   'free_coin_spent',1-v_paid_spent,'purchased_coin_spent',v_paid_spent,
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

commit;
