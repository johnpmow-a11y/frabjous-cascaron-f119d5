-- Complete the social interaction and chat RPCs used by the Netlify functions.
-- Additive only. Existing login, Paystack wallet, tools and email remain untouched.
begin;

-- Private voice-note storage, separate from the existing private-media bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('aam-social-voice','aam-social-voice',false,12582912,array['audio/webm','audio/mp4']::text[])
on conflict (id) do nothing;

create or replace function public.aam_social_toggle_like(p_token uuid,p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_owner uuid; v_deleted integer; v_count bigint;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then raise exception 'Confirm that you are 18 or older first'; end if;
 select customer_id into v_owner from public.aam_social_posts where id=p_post_id and moderation_status='published';
 if not found then raise exception 'Post is unavailable'; end if;
 delete from public.aam_social_likes where post_id=p_post_id and customer_id=v_customer;
 get diagnostics v_deleted=row_count;
 if v_deleted=0 then
   insert into public.aam_social_likes(post_id,customer_id) values(p_post_id,v_customer) on conflict do nothing;
   if v_owner is not null and v_owner<>v_customer then
     insert into public.aam_social_notifications(recipient_id,actor_id,event_type,post_id,title,body)
     values(v_owner,v_customer,'like',p_post_id,'New like','Someone liked your post.');
   end if;
 end if;
 select count(*) into v_count from public.aam_social_likes where post_id=p_post_id;
 return jsonb_build_object('liked',v_deleted=0,'like_count',v_count);
end $$;

create or replace function public.aam_social_add_comment(p_token uuid,p_post_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_owner uuid; v_id uuid; v_body text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then raise exception 'Confirm that you are 18 or older first'; end if;
 v_body=trim(coalesce(p_body,''));
 if length(v_body)<1 or length(v_body)>2000 then raise exception 'Comment must be between 1 and 2,000 characters'; end if;
 select p.customer_id into v_owner from public.aam_social_posts p
 where p.id=p_post_id and p.moderation_status='published' and p.comments_enabled=true;
 if not found then raise exception 'Comments are unavailable for this post'; end if;
 if v_owner is not null and exists(select 1 from public.aam_social_profiles where customer_id=v_owner and comments_enabled=false) then raise exception 'This creator has disabled comments'; end if;
 insert into public.aam_social_comments(post_id,customer_id,body)
 values(p_post_id,v_customer,v_body) returning id into v_id;
 if v_owner is not null and v_owner<>v_customer then
   insert into public.aam_social_notifications(recipient_id,actor_id,event_type,post_id,title,body)
   values(v_owner,v_customer,'comment',p_post_id,'New comment',left(v_body,180));
 end if;
 return jsonb_build_object('ok',true,'comment_id',v_id);
end $$;

create or replace function public.aam_social_update_avatar(p_token uuid,p_avatar_path text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_path text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 v_path=coalesce(p_avatar_path,'');
 if v_path not like 'avatars/'||v_customer::text||'/%' or v_path like '%..%' then raise exception 'Invalid profile picture'; end if;
 insert into public.aam_social_profiles(customer_id,avatar_path)
 values(v_customer,v_path)
 on conflict(customer_id) do update set avatar_path=excluded.avatar_path,updated_at=now();
 insert into public.aam_social_notifications(recipient_id,actor_id,event_type,title,body)
 select followed_id,v_customer,'profile_update','Profile picture updated','A creator you follow changed their profile picture.'
 from public.aam_social_follows where follower_id=v_customer;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.aam_social_update_profile(
 p_token uuid,p_display_name text,p_bio text,p_is_private boolean,p_comments_enabled boolean
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_name text; v_bio text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 v_name=trim(coalesce(p_display_name,''));
 v_bio=trim(coalesce(p_bio,''));
 if length(v_name)<1 or length(v_name)>40 then raise exception 'Display name must be 1–40 characters'; end if;
 if length(v_bio)>300 then raise exception 'Bio must be 300 characters or less'; end if;
 insert into public.aam_social_profiles(customer_id,display_name,bio,is_private,comments_enabled)
 values(v_customer,v_name,v_bio,coalesce(p_is_private,false),coalesce(p_comments_enabled,true))
 on conflict(customer_id) do update set display_name=excluded.display_name,bio=excluded.bio,
 is_private=excluded.is_private,comments_enabled=excluded.comments_enabled,updated_at=now();
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.aam_social_update_preferences(
 p_token uuid,p_sound integer,p_wallpaper text,p_custom_wallpaper_path text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_wallpaper text; v_path text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if p_sound is null or p_sound<1 or p_sound>15 then raise exception 'Choose a valid notification sound'; end if;
 v_wallpaper=coalesce(p_wallpaper,'default');v_path=nullif(coalesce(p_custom_wallpaper_path,''),'');
 if v_wallpaper<>'default' and v_wallpaper<>'custom' and v_wallpaper !~ '^theme-(0[1-9]|1[0-9]|20)$' then raise exception 'Choose a valid wallpaper'; end if;
 if v_wallpaper='custom' and (v_path is null or v_path not like 'wallpapers/'||v_customer::text||'/%' or v_path like '%..%') then raise exception 'Choose a valid custom wallpaper'; end if;
 insert into public.aam_social_preferences(customer_id,notification_sound,chat_wallpaper,custom_wallpaper_path)
 values(v_customer,p_sound,v_wallpaper,case when v_wallpaper='custom' then v_path else null end)
 on conflict(customer_id) do update set notification_sound=excluded.notification_sound,
 chat_wallpaper=excluded.chat_wallpaper,custom_wallpaper_path=excluded.custom_wallpaper_path,updated_at=now();
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.aam_chat_start(p_token uuid,p_target uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_conversation uuid;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then raise exception 'Confirm that you are 18 or older first'; end if;
 if v_customer=p_target or not exists(select 1 from public.customers where id=p_target) then raise exception 'Choose a valid creator'; end if;
 perform pg_advisory_xact_lock(hashtextextended(least(v_customer::text,p_target::text)||':'||greatest(v_customer::text,p_target::text),0));
 select a.conversation_id into v_conversation
 from public.aam_chat_participants a join public.aam_chat_participants b
 on b.conversation_id=a.conversation_id
 where a.customer_id=v_customer and b.customer_id=p_target limit 1;
 if v_conversation is null then
   insert into public.aam_chat_conversations default values returning id into v_conversation;
   insert into public.aam_chat_participants(conversation_id,customer_id)
   values(v_conversation,v_customer),(v_conversation,p_target);
 end if;
 return jsonb_build_object('conversation_id',v_conversation);
end $$;

create or replace function public.aam_chat_send(
 p_token uuid,p_conversation uuid,p_body text,p_type text,p_media_path text,p_shared_post uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_other uuid; v_id uuid; v_body text; v_type text; v_path text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_chat_participants where conversation_id=p_conversation and customer_id=v_customer) then raise exception 'Conversation not found'; end if;
 select customer_id into v_other from public.aam_chat_participants where conversation_id=p_conversation and customer_id<>v_customer limit 1;
 if v_other is null then raise exception 'Conversation recipient not found'; end if;
 v_type=coalesce(p_type,'text');v_body=coalesce(p_body,'');v_path=nullif(coalesce(p_media_path,''),'');
 if v_type not in ('text','image','video','voice','shared_post') then raise exception 'Unsupported message type'; end if;
 if v_type='text' and length(trim(v_body))=0 then raise exception 'Write a message first'; end if;
 if length(v_body)>5000 then raise exception 'Message is too long'; end if;
 if v_type='voice' and (v_path is null or v_path not like 'voice/'||v_customer::text||'/%') then raise exception 'Invalid voice note'; end if;
 if v_type in ('image','video') and (v_path is null or v_path not like v_customer::text||'/chat/%') then raise exception 'Invalid media attachment'; end if;
 if v_type='shared_post' and (p_shared_post is null or not exists(select 1 from public.aam_social_posts where id=p_shared_post and moderation_status='published')) then raise exception 'Shared post is unavailable'; end if;
 insert into public.aam_chat_messages(conversation_id,sender_id,message_type,body,media_path,shared_post_id)
 values(p_conversation,v_customer,v_type,v_body,v_path,p_shared_post) returning id into v_id;
 update public.aam_chat_conversations set updated_at=now() where id=p_conversation;
 insert into public.aam_social_notifications(recipient_id,actor_id,event_type,title,body,message_id)
 values(v_other,v_customer,'message','New message',case when v_type='voice' then 'Sent a voice note' when v_type='shared_post' then 'Shared a post' when v_type in ('image','video') then 'Sent media' else left(v_body,180) end,v_id);
 return jsonb_build_object('ok',true,'message_id',v_id);
end $$;

create or replace function public.aam_chat_mark_read(p_token uuid,p_conversation uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_count integer;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_chat_participants where conversation_id=p_conversation and customer_id=v_customer) then raise exception 'Conversation not found'; end if;
 insert into public.aam_chat_message_reads(message_id,customer_id)
 select m.id,v_customer from public.aam_chat_messages m
 where m.conversation_id=p_conversation and m.sender_id<>v_customer
 on conflict(message_id,customer_id) do nothing;
 get diagnostics v_count=row_count;
 update public.aam_chat_participants set last_seen_at=now()
 where conversation_id=p_conversation and customer_id=v_customer;
 return jsonb_build_object('ok',true,'marked_read',v_count);
end $$;

create or replace function public.aam_chat_touch(p_token uuid,p_conversation uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 update public.aam_chat_participants set last_seen_at=now()
 where conversation_id=p_conversation and customer_id=v_customer;
 if not found then raise exception 'Conversation not found'; end if;
 return jsonb_build_object('ok',true);
end $$;

revoke all on function public.aam_social_toggle_like(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aam_social_add_comment(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.aam_social_update_avatar(uuid,text) from public,anon,authenticated;
revoke all on function public.aam_social_update_profile(uuid,text,text,boolean,boolean) from public,anon,authenticated;
revoke all on function public.aam_social_update_preferences(uuid,integer,text,text) from public,anon,authenticated;
revoke all on function public.aam_chat_start(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aam_chat_send(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.aam_chat_mark_read(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aam_chat_touch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_social_toggle_like(uuid,uuid) to service_role;
grant execute on function public.aam_social_add_comment(uuid,uuid,text) to service_role;
grant execute on function public.aam_social_update_avatar(uuid,text) to service_role;
grant execute on function public.aam_social_update_profile(uuid,text,text,boolean,boolean) to service_role;
grant execute on function public.aam_social_update_preferences(uuid,integer,text,text) to service_role;
grant execute on function public.aam_chat_start(uuid,uuid) to service_role;
grant execute on function public.aam_chat_send(uuid,uuid,text,text,text,uuid) to service_role;
grant execute on function public.aam_chat_mark_read(uuid,uuid) to service_role;
grant execute on function public.aam_chat_touch(uuid,uuid) to service_role;

commit;
