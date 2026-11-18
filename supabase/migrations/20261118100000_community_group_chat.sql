-- All Ads Manager shared community group.
-- Additive migration: existing one-to-one conversations and all payments remain unchanged.
begin;

alter table public.aam_chat_conversations
  add column if not exists conversation_type text not null default 'direct'
    check (conversation_type in ('direct','group')),
  add column if not exists title text,
  add column if not exists owner_kind text not null default 'customer'
    check (owner_kind in ('customer','platform_manager')),
  add column if not exists owner_customer_id uuid references public.customers(id) on delete set null;

create table if not exists public.aam_chat_group_members (
  conversation_id uuid not null references public.aam_chat_conversations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  group_role text not null default 'member' check (group_role in ('member','admin')),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, customer_id)
);

alter table public.aam_chat_group_members enable row level security;
revoke all on public.aam_chat_group_members from public, anon, authenticated;
grant all on public.aam_chat_group_members to service_role;

-- One permanent community group, managed by the platform manager.
insert into public.aam_chat_conversations(id,conversation_type,title,owner_kind,owner_customer_id)
values ('a0000000-0000-4000-8000-000000000001','group','All Ads Manager Community','platform_manager',null)
on conflict (id) do update set conversation_type='group',title='All Ads Manager Community',owner_kind='platform_manager',owner_customer_id=null;

-- Provision every existing customer as a member without changing their other chats.
insert into public.aam_chat_participants(conversation_id,customer_id)
select 'a0000000-0000-4000-8000-000000000001'::uuid,c.id
from public.customers c
on conflict (conversation_id,customer_id) do nothing;

insert into public.aam_chat_group_members(conversation_id,customer_id,group_role)
select 'a0000000-0000-4000-8000-000000000001'::uuid,c.id,'member'
from public.customers c
on conflict (conversation_id,customer_id) do nothing;

create or replace function public.aam_chat_provision_community_member()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.aam_chat_participants(conversation_id,customer_id)
  values('a0000000-0000-4000-8000-000000000001'::uuid,new.id)
  on conflict (conversation_id,customer_id) do nothing;
  insert into public.aam_chat_group_members(conversation_id,customer_id,group_role)
  values('a0000000-0000-4000-8000-000000000001'::uuid,new.id,'member')
  on conflict (conversation_id,customer_id) do nothing;
  return new;
end $$;

drop trigger if exists aam_chat_provision_community_member on public.customers;
create trigger aam_chat_provision_community_member
after insert on public.customers
for each row execute function public.aam_chat_provision_community_member();

-- Group messages use the same message/read-receipt records as direct chats.
-- Direct chats retain their existing two-person validation.
create or replace function public.aam_chat_send(
 p_token uuid,p_conversation uuid,p_body text,p_type text,p_media_path text,p_shared_post uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_customer uuid; v_other uuid; v_id uuid; v_body text; v_type text; v_path text;
 v_group boolean; v_recipients integer;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_chat_participants where conversation_id=p_conversation and customer_id=v_customer) then raise exception 'Conversation not found'; end if;
 select conversation_type='group' into v_group from public.aam_chat_conversations where id=p_conversation;
 if coalesce(v_group,false) then
   if not exists(select 1 from public.aam_chat_group_members where conversation_id=p_conversation and customer_id=v_customer) then raise exception 'You are not a member of this group'; end if;
 else
   select customer_id into v_other from public.aam_chat_participants where conversation_id=p_conversation and customer_id<>v_customer limit 1;
   if v_other is null then raise exception 'Conversation recipient not found'; end if;
 end if;
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
 if v_group then
   insert into public.aam_social_notifications(recipient_id,actor_id,event_type,title,body,message_id)
   select gm.customer_id,v_customer,'message','New community message',
     case when v_type='voice' then 'A member sent a voice note' when v_type='shared_post' then 'A member shared a post' when v_type in ('image','video') then 'A member shared media' else left(v_body,180) end,v_id
   from public.aam_chat_group_members gm
   where gm.conversation_id=p_conversation and gm.customer_id<>v_customer;
 else
   insert into public.aam_social_notifications(recipient_id,actor_id,event_type,title,body,message_id)
   values(v_other,v_customer,case when v_type='shared_post' then 'share' else 'message' end,'New message',
     case when v_type='voice' then 'Sent a voice note' when v_type='shared_post' then 'Shared a post' when v_type in ('image','video') then 'Sent media' else left(v_body,180) end,v_id);
 end if;
 return jsonb_build_object('ok',true,'message_id',v_id,'group_message',coalesce(v_group,false));
end $$;

-- Called only by the existing, server-validated platform-admin Netlify endpoint.
create or replace function public.aam_chat_group_set_admin(p_customer_id uuid,p_make_admin boolean)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_group constant uuid := 'a0000000-0000-4000-8000-000000000001'::uuid;
begin
 if not exists(select 1 from public.aam_chat_group_members where conversation_id=v_group and customer_id=p_customer_id) then
   raise exception 'That customer is not a member of the community group';
 end if;
 update public.aam_chat_group_members
 set group_role=case when p_make_admin then 'admin' else 'member' end
 where conversation_id=v_group and customer_id=p_customer_id;
 return jsonb_build_object('ok',true,'customer_id',p_customer_id,'group_role',case when p_make_admin then 'admin' else 'member' end);
end $$;

revoke all on function public.aam_chat_provision_community_member() from public,anon,authenticated;
revoke all on function public.aam_chat_group_set_admin(uuid,boolean) from public,anon,authenticated;
grant execute on function public.aam_chat_group_set_admin(uuid,boolean) to service_role;
grant execute on function public.aam_chat_send(uuid,uuid,text,text,text,uuid) to service_role;

commit;
