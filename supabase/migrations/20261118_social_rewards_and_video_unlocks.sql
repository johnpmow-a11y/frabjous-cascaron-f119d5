-- Secure, idempotent social reward and video-unlock operations.
-- Coin purchases are intentionally not connected to Paystack in this migration.
begin;

create table if not exists public.aam_social_video_unlocks (
  customer_id uuid not null references public.customers(id) on delete cascade,
  post_id uuid not null references public.aam_social_posts(id) on delete cascade,
  coin_transaction_id uuid unique references public.aam_coin_transactions(id) on delete set null,
  unlocked_at timestamptz not null default now(),
  primary key (customer_id, post_id)
);
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

commit;
