-- Manager Promotion: campaign drafts and Money-Coin-only payment.
-- Campaigns remain queued until an administrator connects/approves the advertising provider.
begin;

create table if not exists public.aam_social_promotions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  promotion_type text not null check (promotion_type in
    ('viral_profile','viral_video','photo','relationship','business','music','follower_growth')),
  title text not null check (char_length(title) between 3 and 100),
  description text not null check (char_length(description) between 5 and 2000),
  media_path text not null,
  destination_url text,
  requested_days integer not null default 7 check (requested_days between 1 and 90),
  price_coins bigint check (price_coins is null or price_coins > 0),
  status text not null default 'pending_review' check (status in
    ('pending_review','awaiting_payment','paid_provider_pending','active','paused','rejected','completed')),
  provider_status text not null default 'not_connected' check (provider_status in
    ('not_connected','awaiting_partner_access','ready','submitted','running','failed')),
  admin_note text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aam_social_promotions_customer_idx
  on public.aam_social_promotions(customer_id,created_at desc);
create index if not exists aam_social_promotions_status_idx
  on public.aam_social_promotions(status,created_at desc);

create table if not exists public.aam_social_promotion_transactions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.aam_social_promotions(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete cascade,
  money_coins_spent bigint not null check (money_coins_spent > 0),
  amount_naira bigint not null check (amount_naira = money_coins_spent),
  created_at timestamptz not null default now(),
  unique(promotion_id)
);

alter table public.aam_social_promotions enable row level security;
alter table public.aam_social_promotion_transactions enable row level security;
revoke all on public.aam_social_promotions,public.aam_social_promotion_transactions from public,anon,authenticated;
grant all on public.aam_social_promotions,public.aam_social_promotion_transactions to service_role;

-- Customer submits a promotion brief. No coins are deducted at this stage:
-- admin/provider pricing must be confirmed before the customer accepts payment.
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
   raise exception 'Choose a valid Manager Promotion type';
 end if;
 v_title=trim(coalesce(p_title,'')); v_description=trim(coalesce(p_description,'')); v_path=trim(coalesce(p_media_path,''));
 if char_length(v_title) not between 3 and 100 then raise exception 'Enter an advert title between 3 and 100 characters'; end if;
 if char_length(v_description) not between 5 and 2000 then raise exception 'Enter an advert description'; end if;
 if v_path not like 'promotions/'||v_customer::text||'/%' or position('..' in v_path)>0 then
   raise exception 'Upload the promotion picture using the secure upload control';
 end if;
 if coalesce(p_requested_days,0) not between 1 and 90 then raise exception 'Choose a duration from 1 to 90 days'; end if;
 insert into public.aam_social_promotions(customer_id,promotion_type,title,description,media_path,destination_url,requested_days)
 values(v_customer,v_type,v_title,v_description,v_path,nullif(trim(coalesce(p_destination_url,'')),''),p_requested_days)
 returning id into v_id;
 return jsonb_build_object('created',true,'promotion_id',v_id,'status','pending_review',
   'message','Your promotion brief was submitted for review. No coins have been deducted.');
end;
$$;

-- Customer can pay only after an administrator sets the approved coin price.
-- The RPC deducts purchased/Money Coins only; Free Coins are never eligible.
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
 if v_p.status<>'awaiting_payment' or v_p.price_coins is null or v_p.price_coins<1 then
   raise exception 'This promotion is not priced and ready for payment yet';
 end if;
 if exists(select 1 from public.aam_social_promotion_transactions where promotion_id=v_p.id) then
   return jsonb_build_object('paid',true,'already_paid',true,'status',v_p.status);
 end if;
 select purchased_coins into v_money from public.aam_coin_balances
 where customer_id=v_customer for update;
 if coalesce(v_money,0)<v_p.price_coins then
   raise exception 'Insufficient Money Coins. Free Coins cannot be used for promotion. Please buy Money Coins.';
 end if;
 update public.aam_coin_balances
 set purchased_coins=purchased_coins-v_p.price_coins,
     balance_coins=balance_coins-v_p.price_coins,updated_at=now()
 where customer_id=v_customer;
 insert into public.aam_social_promotion_transactions(promotion_id,customer_id,money_coins_spent,amount_naira)
 values(v_p.id,v_customer,v_p.price_coins,v_p.price_coins);
 update public.aam_social_promotions set status='paid_provider_pending',
   paid_at=now(),updated_at=now()
 where id=v_p.id;
 insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description)
 values(v_customer,'promotion:'||v_p.id::text,'promotion_payment',-v_p.price_coins,
   'Manager Promotion payment with Money Coins')
 on conflict(reference) do nothing;
 return jsonb_build_object('paid',true,'money_coins_spent',v_p.price_coins,
   'naira_spent',v_p.price_coins,'status','paid_provider_pending',
   'message','Payment recorded. Promotion will not run until provider access and campaign approval are complete.');
end;
$$;

revoke all on function public.aam_social_promotion_create(uuid,text,text,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.aam_social_promotion_pay(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_social_promotion_create(uuid,text,text,text,text,text,integer) to service_role;
grant execute on function public.aam_social_promotion_pay(uuid,uuid) to service_role;

commit;
