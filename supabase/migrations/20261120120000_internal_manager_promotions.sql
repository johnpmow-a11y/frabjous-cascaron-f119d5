-- Internal All Ads Manager promotions: no external advertising partner required.
-- Paid, approved promotions run inside the AAM Home feed.
begin;

create or replace function public.aam_social_promotion_create(
  p_token uuid,promotion_type text,p_title text,p_description text,
  p_media_path text,p_destination_url text,p_requested_days integer
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_id uuid; v_type text; v_title text; v_description text; v_path text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then
   raise exception 'Confirm that you are 18 or older to continue';
 end if;
 v_type=lower(trim(coalesce(promotion_type,'')));
 if v_type not in ('viral_profile','viral_video','photo','relationship','business','music','follower_growth') then
   raise exception 'Choose a valid promotion type';
 end if;
 v_title=trim(coalesce(p_title,'')); v_description=trim(coalesce(p_description,'')); v_path=trim(coalesce(p_media_path,''));
 if char_length(v_title) not between 3 and 100 then raise exception 'Enter a valid advert title'; end if;
 if char_length(v_description) not between 5 and 2000 then raise exception 'Enter an advert description'; end if;
 if v_path not like 'promotions/'||v_customer::text||'/%' or position('..' in v_path)>0 then
   raise exception 'Upload the promotion picture using the secure upload control';
 end if;
 if coalesce(p_requested_days,0) not between 1 and 90 then raise exception 'Choose a duration from 1 to 90 days'; end if;
 insert into public.aam_social_promotions(customer_id,promotion_type,title,description,media_path,destination_url,requested_days,provider_status)
 values(v_customer,v_type,v_title,v_description,v_path,nullif(trim(coalesce(p_destination_url,'')),''),p_requested_days,'ready')
 returning id into v_id;
 return jsonb_build_object('created',true,'promotion_id',v_id,'status','pending_review','message','Promotion submitted.');
end;
$$;

create or replace function public.aam_social_promotion_pay(p_token uuid,p_promotion_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_p public.aam_social_promotions; v_money bigint;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 select * into v_p from public.aam_social_promotions
 where id=p_promotion_id and customer_id=v_customer for update;
 if v_p.id is null then raise exception 'Promotion not found'; end if;
 if v_p.status<>'awaiting_payment' or v_p.provider_status<>'ready' or v_p.price_coins is null or v_p.price_coins<1 then
   raise exception 'This promotion is not approved and priced yet';
 end if;
 if exists(select 1 from public.aam_social_promotion_transactions where promotion_id=v_p.id) then
   return jsonb_build_object('paid',true,'already_paid',true,'status',v_p.status);
 end if;
 select purchased_coins into v_money from public.aam_coin_balances
 where customer_id=v_customer for update;
 if coalesce(v_money,0)<v_p.price_coins then
   raise exception 'Insufficient Money Coins. Please buy Money Coins.';
 end if;
 update public.aam_coin_balances
 set purchased_coins=purchased_coins-v_p.price_coins,
     balance_coins=balance_coins-v_p.price_coins,updated_at=now()
 where customer_id=v_customer;
 insert into public.aam_social_promotion_transactions(promotion_id,customer_id,money_coins_spent,amount_naira)
 values(v_p.id,v_customer,v_p.price_coins,v_p.price_coins);
 insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description)
 values(v_customer,'promotion:'||v_p.id::text,'promotion_payment',-v_p.price_coins,
   'All Ads Manager in-app promotion payment')
 on conflict(reference) do nothing;
 update public.aam_social_promotions set status='active',provider_status='running',
   paid_at=now(),updated_at=now()
 where id=v_p.id;
 return jsonb_build_object('paid',true,'money_coins_spent',v_p.price_coins,
   'naira_spent',v_p.price_coins,'status','active',
   'message','Your promotion is now active inside All Ads Manager.');
end;
$$;

revoke all on function public.aam_social_promotion_create(uuid,text,text,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.aam_social_promotion_pay(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_social_promotion_create(uuid,text,text,text,text,text,integer) to service_role;
grant execute on function public.aam_social_promotion_pay(uuid,uuid) to service_role;

commit;
