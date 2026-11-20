-- Run paid customer promotions inside the All Ads Manager feed.
-- No external ad network or partner account is required for in-app placements.
begin;

alter table public.aam_social_posts
  add column if not exists promotion_id uuid,
  add column if not exists is_promoted boolean not null default false,
  add column if not exists destination_url text,
  add column if not exists promotion_type text;

alter table public.aam_social_promotions
  add column if not exists post_id uuid,
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='aam_social_posts_promotion_id_fkey') then
    alter table public.aam_social_posts
      add constraint aam_social_posts_promotion_id_fkey
      foreign key (promotion_id) references public.aam_social_promotions(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='aam_social_promotions_post_id_fkey') then
    alter table public.aam_social_promotions
      add constraint aam_social_promotions_post_id_fkey
      foreign key (post_id) references public.aam_social_posts(id) on delete set null;
  end if;
end $$;

create unique index if not exists aam_social_posts_promotion_id_uidx
  on public.aam_social_posts(promotion_id) where promotion_id is not null;

create index if not exists aam_social_promotions_live_idx
  on public.aam_social_promotions(status, ends_at desc)
  where status='active';

update public.aam_social_promotions
set provider_status='ready', updated_at=now()
where status='pending_review' and provider_status='not_connected';

create or replace function public.aam_social_promotion_create(
  p_token uuid,promotion_type text,p_title text,p_description text,
  p_media_path text,p_destination_url text,p_requested_days integer
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_id uuid; v_type text; v_title text; v_description text; v_path text; v_destination text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then
   raise exception 'Confirm that you are 18 or older to continue';
 end if;
 v_type=lower(trim(coalesce(promotion_type,'')));
 if v_type not in ('viral_profile','viral_video','photo','relationship','business','music','follower_growth') then
   raise exception 'Choose a valid Manager Promotion type';
 end if;
 v_title=trim(coalesce(p_title,'')); v_description=trim(coalesce(p_description,'')); v_path=trim(coalesce(p_media_path,''));
 v_destination=nullif(trim(coalesce(p_destination_url,'')),'');
 if char_length(v_title) not between 3 and 100 then raise exception 'Enter an advert title between 3 and 100 characters'; end if;
 if char_length(v_description) not between 5 and 2000 then raise exception 'Enter an advert description'; end if;
 if v_path not like 'promotions/'||v_customer::text||'/%' or position('..' in v_path)>0 then
   raise exception 'Upload the promotion picture using the secure upload control';
 end if;
 if v_destination is not null and v_destination !~* '^https?://' then
   raise exception 'Enter a valid website link starting with https://';
 end if;
 if coalesce(p_requested_days,0) not between 1 and 90 then raise exception 'Choose a duration from 1 to 90 days'; end if;
 insert into public.aam_social_promotions(customer_id,promotion_type,title,description,media_path,destination_url,requested_days,provider_status)
 values(v_customer,v_type,v_title,v_description,v_path,v_destination,p_requested_days,'ready')
 returning id into v_id;
 return jsonb_build_object('created',true,'promotion_id',v_id,'status','pending_review',
   'message','Advert submitted. All Ads Manager will review it and set the Money Coin price.');
end;
$$;

create or replace function public.aam_social_promotion_pay(p_token uuid,p_promotion_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_p public.aam_social_promotions; v_money bigint; v_post_id uuid;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 select * into v_p from public.aam_social_promotions
 where id=p_promotion_id and customer_id=v_customer for update;
 if v_p.id is null then raise exception 'Promotion not found'; end if;
 if v_p.status='active' and exists(select 1 from public.aam_social_promotion_transactions where promotion_id=v_p.id) then
   return jsonb_build_object('paid',true,'already_paid',true,'status','active','post_id',v_p.post_id);
 end if;
 if v_p.status<>'awaiting_payment' or v_p.provider_status<>'ready' or v_p.price_coins is null or v_p.price_coins<1 then
   raise exception 'This promotion is not approved for payment yet';
 end if;
 if exists(select 1 from public.aam_social_promotion_transactions where promotion_id=v_p.id) then
   return jsonb_build_object('paid',true,'already_paid',true,'status',v_p.status,'post_id',v_p.post_id);
 end if;
 select purchased_coins into v_money from public.aam_coin_balances
 where customer_id=v_customer for update;
 if coalesce(v_money,0)<v_p.price_coins then
   raise exception 'Insufficient Money Coins. Free Coins cannot be used for promotion. Please buy Money Coins.';
 end if;
 insert into public.aam_social_posts(
   customer_id,author_role,media_type,media_path,caption,post_kind,moderation_status,
   is_locked,is_promoted,promotion_id,destination_url,promotion_type
 ) values (
   v_customer,'customer','image',v_p.media_path,
   left(v_p.title||E'\n'||v_p.description,2200),'feed','published',
   false,true,v_p.id,v_p.destination_url,v_p.promotion_type
 ) returning id into v_post_id;
 update public.aam_coin_balances
 set purchased_coins=purchased_coins-v_p.price_coins,
     balance_coins=balance_coins-v_p.price_coins,updated_at=now()
 where customer_id=v_customer;
 insert into public.aam_social_promotion_transactions(promotion_id,customer_id,money_coins_spent,amount_naira)
 values(v_p.id,v_customer,v_p.price_coins,v_p.price_coins);
 insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description)
 values(v_customer,'promotion:'||v_p.id::text,'promotion_payment',-v_p.price_coins,
   'All Ads Manager feed promotion payment with Money Coins')
 on conflict(reference) do nothing;
 update public.aam_social_promotions
 set status='active',provider_status='running',post_id=v_post_id,
     starts_at=now(),ends_at=now()+make_interval(days=>v_p.requested_days),
     paid_at=now(),updated_at=now()
 where id=v_p.id;
 return jsonb_build_object('paid',true,'money_coins_spent',v_p.price_coins,
   'naira_spent',v_p.price_coins,'status','active','post_id',v_post_id,
   'message','Your promoted post is now running in the All Ads Manager feed.');
end;
$$;

revoke all on function public.aam_social_promotion_create(uuid,text,text,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.aam_social_promotion_pay(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_social_promotion_create(uuid,text,text,text,text,text,integer) to service_role;
grant execute on function public.aam_social_promotion_pay(uuid,uuid) to service_role;

commit;
