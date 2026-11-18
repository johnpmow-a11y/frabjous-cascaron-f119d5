-- All Ads Manager: remove age confirmation and reserve Promotion Coins for promotion only.
-- No video unlocks, viewing charges, follow rewards or referral coin rewards remain.
begin;

drop function if exists public.aam_social_confirm_age(uuid);
alter table public.aam_social_profiles drop column if exists adult_confirmed_at;
drop table if exists public.aam_social_video_unlocks cascade;

create or replace function public.aam_social_follow(p_token uuid,p_target uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_follower uuid; v_inserted integer;
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
    insert into public.aam_social_notifications(recipient_id,actor_id,event_type,title,body)
    values(p_target,v_follower,'follow','New follower','Someone followed your profile.');
  end if;
  return jsonb_build_object('following',true,'new_follow',v_inserted=1,'promotion_coins_earned',0);
end;
$$;

create or replace function public.aam_social_apply_referral(p_token uuid,p_referral_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_customer uuid;
begin
  select customer_id into v_customer from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_customer is null then raise exception 'Session expired'; end if;
  return jsonb_build_object('applied',false,'reason','promotion_coins_are_purchase_only');
end;
$$;

create or replace function public.aam_social_unlock_video(p_token uuid,p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_customer uuid; v_post public.aam_social_posts;
begin
  select customer_id into v_customer from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_customer is null then raise exception 'Session expired'; end if;
  select * into v_post from public.aam_social_posts
  where id=p_post_id and media_type='video' and moderation_status='published';
  if v_post.id is null then raise exception 'Video is unavailable'; end if;
  if v_post.customer_id is not null
     and exists(select 1 from public.aam_social_profiles where customer_id=v_post.customer_id and is_private=true)
     and v_post.customer_id<>v_customer
     and not exists(select 1 from public.aam_social_follows where follower_id=v_customer and followed_id=v_post.customer_id) then
    raise exception 'This profile is private';
  end if;
  return jsonb_build_object('unlocked',true,'free_video',true,'coins_charged',0);
end;
$$;

revoke all on function public.aam_social_follow(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aam_social_apply_referral(uuid,text) from public,anon,authenticated;
revoke all on function public.aam_social_unlock_video(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_social_follow(uuid,uuid) to service_role;
grant execute on function public.aam_social_apply_referral(uuid,text) to service_role;
grant execute on function public.aam_social_unlock_video(uuid,uuid) to service_role;
commit;
