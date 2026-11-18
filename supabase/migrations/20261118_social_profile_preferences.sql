-- Profile and notification/chat preference updates through the existing customer session.
begin;
create or replace function public.aam_social_update_profile(p_token uuid,p_display_name text,p_bio text,p_is_private boolean,p_comments_enabled boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_customer uuid; v_name text; v_bio text;
begin
 select customer_id into v_customer from public.customer_sessions where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 v_name=left(trim(coalesce(p_display_name,'')),40); v_bio=left(trim(coalesce(p_bio,'')),300);
 if length(v_name)<1 then raise exception 'Enter a display name'; end if;
 update public.aam_social_profiles set display_name=v_name,bio=v_bio,is_private=coalesce(p_is_private,false),comments_enabled=coalesce(p_comments_enabled,true),updated_at=now()
 where customer_id=v_customer;
 if not found then insert into public.aam_social_profiles(customer_id,display_name,bio,is_private,comments_enabled) values(v_customer,v_name,v_bio,coalesce(p_is_private,false),coalesce(p_comments_enabled,true)); end if;
 return jsonb_build_object('saved',true);
end;
$$;
create or replace function public.aam_social_update_preferences(p_token uuid,p_sound integer,p_wallpaper text,p_custom_wallpaper_path text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_customer uuid; v_wallpaper text;
begin
 select customer_id into v_customer from public.customer_sessions where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if p_sound<1 or p_sound>15 then raise exception 'Choose a valid notification sound'; end if;
 v_wallpaper=coalesce(p_wallpaper,'default');
 if v_wallpaper not in ('custom','default','theme-01','theme-02','theme-03','theme-04','theme-05','theme-06','theme-07','theme-08','theme-09','theme-10','theme-11','theme-12','theme-13','theme-14','theme-15','theme-16','theme-17','theme-18','theme-19','theme-20') then raise exception 'Choose a valid chat wallpaper'; end if;
 if p_custom_wallpaper_path is not null and (p_custom_wallpaper_path not like 'wallpapers/'||v_customer::text||'/%' or position('..' in p_custom_wallpaper_path)>0) then raise exception 'Invalid custom wallpaper'; end if;
 if v_wallpaper='custom' and p_custom_wallpaper_path is null then raise exception 'Upload a custom wallpaper first'; end if;
 insert into public.aam_social_preferences(customer_id,notification_sound,chat_wallpaper,custom_wallpaper_path)
 values(v_customer,p_sound,v_wallpaper,p_custom_wallpaper_path)
 on conflict(customer_id) do update set notification_sound=excluded.notification_sound,chat_wallpaper=excluded.chat_wallpaper,custom_wallpaper_path=excluded.custom_wallpaper_path,updated_at=now();
 return jsonb_build_object('saved',true);
end;
$$;
revoke all on function public.aam_social_update_profile(uuid,text,text,boolean,boolean) from public,anon,authenticated;
revoke all on function public.aam_social_update_preferences(uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.aam_social_update_profile(uuid,text,text,boolean,boolean) to service_role;
grant execute on function public.aam_social_update_preferences(uuid,integer,text) to service_role;
commit;
