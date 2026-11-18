-- Keep one-to-one chat lookup separate from the shared community conversation.
begin;

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
 if exists(select 1 from public.aam_social_profiles where customer_id=p_target and is_private=true) and not exists(select 1 from public.aam_social_follows where follower_id=v_customer and followed_id=p_target) then raise exception 'Follow this private profile before messaging'; end if;
 perform pg_advisory_xact_lock(hashtextextended(least(v_customer::text,p_target::text)||':'||greatest(v_customer::text,p_target::text),0));
 select a.conversation_id into v_conversation
 from public.aam_chat_participants a
 join public.aam_chat_participants b on b.conversation_id=a.conversation_id
 join public.aam_chat_conversations c on c.id=a.conversation_id and c.conversation_type='direct'
 where a.customer_id=v_customer and b.customer_id=p_target
 limit 1;
 if v_conversation is null then
   insert into public.aam_chat_conversations(conversation_type) values('direct') returning id into v_conversation;
   insert into public.aam_chat_participants(conversation_id,customer_id)
   values(v_conversation,v_customer),(v_conversation,p_target);
 end if;
 return jsonb_build_object('conversation_id',v_conversation);
end $$;

revoke all on function public.aam_chat_start(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_chat_start(uuid,uuid) to service_role;

commit;
