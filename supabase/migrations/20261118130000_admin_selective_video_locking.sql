-- Restore optional admin video locks funded by Promotion Coins.
-- One unlock costs 1 coin once per customer per locked admin video.
begin;

alter table public.aam_social_posts
  add column if not exists is_locked boolean not null default false;

create table if not exists public.aam_social_video_unlocks (
  customer_id uuid not null references public.customers(id) on delete cascade,
  post_id uuid not null references public.aam_social_posts(id) on delete cascade,
  coins_charged bigint not null default 1 check (coins_charged = 1),
  unlocked_at timestamptz not null default now(),
  primary key (customer_id, post_id)
);
create index if not exists aam_social_video_unlocks_post_idx
  on public.aam_social_video_unlocks(post_id, unlocked_at desc);

alter table public.aam_social_video_unlocks enable row level security;
revoke all on public.aam_social_video_unlocks from public, anon, authenticated;
grant all on public.aam_social_video_unlocks to service_role;

create or replace function public.aam_social_unlock_video(p_token uuid,p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_customer uuid;
  v_post public.aam_social_posts;
  v_balance bigint;
begin
  select customer_id into v_customer
  from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_customer is null then raise exception 'Session expired'; end if;

  select * into v_post
  from public.aam_social_posts
  where id=p_post_id and media_type='video' and moderation_status='published';
  if v_post.id is null then raise exception 'Video is unavailable'; end if;

  if v_post.author_role <> 'admin' or not coalesce(v_post.is_locked,false) then
    return jsonb_build_object('unlocked',true,'free_video',true,'coins_charged',0);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_customer::text||':'||p_post_id::text,0));

  if exists(select 1 from public.aam_social_video_unlocks
            where customer_id=v_customer and post_id=p_post_id) then
    select balance_coins into v_balance from public.aam_coin_balances
    where customer_id=v_customer;
    return jsonb_build_object('unlocked',true,'already_unlocked',true,
      'coins_charged',0,'coin_balance',coalesce(v_balance,0));
  end if;

  update public.aam_coin_balances
  set balance_coins=balance_coins-1,updated_at=now()
  where customer_id=v_customer and balance_coins>=1
  returning balance_coins into v_balance;

  if v_balance is null then raise exception 'Insufficient Promotion Coins'; end if;

  insert into public.aam_social_video_unlocks(customer_id,post_id,coins_charged)
  values(v_customer,p_post_id,1);

  insert into public.aam_coin_transactions(
    customer_id,reference,transaction_type,amount_coins,description,related_post_id
  ) values (
    v_customer,'video_unlock:'||v_customer::text||':'||p_post_id::text,
    'video_view',-1,'Unlocked an administrator video',p_post_id
  );

  return jsonb_build_object('unlocked',true,'already_unlocked',false,
    'coins_charged',1,'coin_balance',v_balance);
end;
$$;

revoke all on function public.aam_social_unlock_video(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_social_unlock_video(uuid,uuid) to service_role;

commit;
