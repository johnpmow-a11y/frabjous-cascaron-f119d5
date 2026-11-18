-- Idempotent like and comment operations for All Ads Manager social posts.
begin;
create or replace function public.aam_social_toggle_like(p_token uuid,p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_customer uuid; v_owner uuid; v_liked boolean;
begin
 select customer_id into v_customer from public.customer_sessions where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 select customer_id into v_owner from public.aam_social_posts where id=p_post_id and moderation_status='published';
 if not found then raise exception 'Post is unavailable'; end if;
 if v_owner is not null and v_owner<>v_customer and exists(select 1 from public.aam_social_profiles where customer_id=v_owner and is_private=true) and not exists(select 1 from public.aam_social_follows where follower_id=v_customer and followed_id=v_owner) then raise exception 'This profile is private'; end if;
 if exists(select 1 from public.aam_social_likes where post_id=p_post_id and customer_id=v_customer) then
   delete from public.aam_social_likes where post_id=p_post_id and customer_id=v_customer;
   v_liked=false;
 else
   insert into public.aam_social_likes(post_id,customer_id) values(p_post_id,v_customer) on conflict do nothing;
   v_liked=true;
   if v_owner is not null and v_owner<>v_customer then
     insert into public.aam_social_notifications(recipient_id,actor_id,event_type,post_id,title,body)
     values(v_owner,v_customer,'like',p_post_id,'New like','Someone liked your post.');
   end if;
 end if;
 return jsonb_build_object('liked',v_liked,'like_count',(select count(*) from public.aam_social_likes where post_id=p_post_id));
end;
$$;
create or replace function public.aam_social_add_comment(p_token uuid,p_post_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_customer uuid; v_owner uuid; v_body text; v_id uuid;
begin
 select customer_id into v_customer from public.customer_sessions where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 v_body=left(trim(coalesce(p_body,'')),2000);
 if length(v_body)=0 then raise exception 'Write a comment first'; end if;
 select customer_id into v_owner from public.aam_social_posts where id=p_post_id and moderation_status='published' and comments_enabled=true;
 if not found then raise exception 'Comments are unavailable for this post'; end if;
 if v_owner is not null and v_owner<>v_customer and exists(select 1 from public.aam_social_profiles where customer_id=v_owner and is_private=true) and not exists(select 1 from public.aam_social_follows where follower_id=v_customer and followed_id=v_owner) then raise exception 'This profile is private'; end if;
 insert into public.aam_social_comments(post_id,customer_id,body) values(p_post_id,v_customer,v_body) returning id into v_id;
 if v_owner is not null and v_owner<>v_customer then
   insert into public.aam_social_notifications(recipient_id,actor_id,event_type,post_id,title,body)
   values(v_owner,v_customer,'comment',p_post_id,'New comment',left(v_body,180));
 end if;
 return jsonb_build_object('ok',true,'comment_id',v_id);
end;
$$;
revoke all on function public.aam_social_toggle_like(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aam_social_add_comment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.aam_social_toggle_like(uuid,uuid) to service_role;
grant execute on function public.aam_social_add_comment(uuid,uuid,text) to service_role;
commit;
