-- Per-event social notification preferences for customers.
begin;
alter table public.aam_social_preferences add column if not exists profile_update_notifications boolean not null default true;
drop function if exists public.aam_social_update_notification_preferences(uuid,boolean,boolean,boolean,boolean,boolean,boolean);
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
commit;
