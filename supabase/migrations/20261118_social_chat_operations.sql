-- Secure one-to-one social chat primitives. All access is session-verified server-side.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('aam-social-voice','aam-social-voice',false,5242880,array['audio/webm','audio/mp4']::text[])
on conflict (id) do nothing;
create or replace function public.aam_chat_start(p_token uuid,p_target uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_me uuid; v_conversation uuid;
begin
 select customer_id into v_me from public.customer_sessions where token=p_token and expires_at>now();
 if v_me is null then raise exception 'Session expired'; end if;
 if v_me=p_target then raise exception 'You cannot message yourself'; end if;
 if not exists(select 1 from public.customers where id=p_target) then raise exception 'Profile not found'; end if;
 if exists(select 1 from public.aam_social_profiles where customer_id=p_target and is_private=true)
    and not exists(select 1 from public.aam_social_follows where follower_id=v_me and followed_id=p_target) then
   raise exception 'Follow this private profile before messaging';
 end if;
 perform pg_advisory_xact_lock(hashtext(least(v_me::text,p_target::text)||':'||greatest(v_me::text,p_target::text)));
 select c.id into v_conversation
 from public.aam_chat_conversations c
 join public.aam_chat_participants a on a.conversation_id=c.id and a.customer_id=v_me
 join public.aam_chat_participants b on b.conversation_id=c.id and b.customer_id=p_target
 where (select count(*) from public.aam_chat_participants z where z.conversation_id=c.id)=2
 limit 1;
 if v_conversation is null then
  insert into public.aam_chat_conversations default values returning id into v_conversation;
  insert into public.aam_chat_participants(conversation_id,customer_id) values(v_conversation,v_me),(v_conversation,p_target);
 end if;
 return jsonb_build_object('conversation_id',v_conversation);
end;
$$;
create or replace function public.aam_chat_send(p_token uuid,p_conversation uuid,p_body text,p_type text default 'text',p_media_path text default null,p_shared_post uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_me uuid; v_message uuid; v_type text; v_body text;
begin
 select customer_id into v_me from public.customer_sessions where token=p_token and expires_at>now();
 if v_me is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_chat_participants where conversation_id=p_conversation and customer_id=v_me) then raise exception 'Conversation not found'; end if;
 v_type=coalesce(p_type,'text'); v_body=left(trim(coalesce(p_body,'')),5000);
 if v_type not in ('text','image','video','voice','shared_post') then raise exception 'Invalid message type'; end if;
 if v_type='text' and length(v_body)=0 then raise exception 'Write a message first'; end if;
 if v_type='voice' and p_media_path is null then raise exception 'Voice note is missing'; end if;
 if v_type='shared_post' and (p_shared_post is null or not exists(select 1 from public.aam_social_posts where id=p_shared_post and moderation_status='published')) then raise exception 'Shared post is unavailable'; end if;
 insert into public.aam_chat_messages(conversation_id,sender_id,message_type,body,media_path,shared_post_id)
 values(p_conversation,v_me,v_type,v_body,p_media_path,p_shared_post) returning id into v_message;
 update public.aam_chat_conversations set updated_at=now() where id=p_conversation;
 insert into public.aam_social_notifications(recipient_id,actor_id,event_type,message_id,title,body)
 select customer_id,v_me,'message',v_message,'New message',case when v_type='voice' then 'Sent a voice note' when v_type in ('image','video') then 'Sent media' else left(v_body,160) end
 from public.aam_chat_participants where conversation_id=p_conversation and customer_id<>v_me;
 return jsonb_build_object('message_id',v_message,'sent',true);
end;
$$;
create or replace function public.aam_chat_mark_read(p_token uuid,p_conversation uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_me uuid; v_count integer;
begin
 select customer_id into v_me from public.customer_sessions where token=p_token and expires_at>now();
 if v_me is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_chat_participants where conversation_id=p_conversation and customer_id=v_me) then raise exception 'Conversation not found'; end if;
 insert into public.aam_chat_message_reads(message_id,customer_id)
 select m.id,v_me from public.aam_chat_messages m where m.conversation_id=p_conversation and m.sender_id<>v_me
 on conflict(message_id,customer_id) do nothing;
 get diagnostics v_count=row_count;
 update public.aam_chat_participants set last_seen_at=now() where conversation_id=p_conversation and customer_id=v_me;
 return jsonb_build_object('read_count',v_count);
end;
$$;
create or replace function public.aam_chat_touch(p_token uuid,p_conversation uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $
declare v_me uuid;
begin
 select customer_id into v_me from public.customer_sessions where token=p_token and expires_at>now();
 if v_me is null then raise exception 'Session expired'; end if;
 update public.aam_chat_participants set last_seen_at=now() where conversation_id=p_conversation and customer_id=v_me;
 if not found then raise exception 'Conversation not found'; end if;
 return jsonb_build_object('last_seen_at',now());
end;
$;
revoke all on function public.aam_chat_touch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_chat_touch(uuid,uuid) to service_role;
revoke all on function public.aam_chat_start(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aam_chat_send(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.aam_chat_mark_read(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_chat_start(uuid,uuid) to service_role;
grant execute on function public.aam_chat_send(uuid,uuid,text,text,text,uuid) to service_role;
grant execute on function public.aam_chat_mark_read(uuid,uuid) to service_role;
commit;
