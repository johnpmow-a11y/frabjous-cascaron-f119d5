-- Correct Professional Video charging: only admin-published videos cost one coin.
-- Customer videos and all pictures remain free. Unlocks are idempotent per customer/video.
begin;

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

commit;
