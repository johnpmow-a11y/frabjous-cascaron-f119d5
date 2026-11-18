-- Enforce per-event notification preferences for in-app alerts and count unique profile viewers.
begin;

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

commit;
