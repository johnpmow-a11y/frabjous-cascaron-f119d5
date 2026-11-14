-- All Ads Manager: separate universal administrator wallet.
-- Additive only: customer wallet tables, deposits, and purchase RPCs are unchanged.
begin;

create table if not exists public.admin_wallet_balances (
  id smallint primary key default 1 check (id = 1),
  balance_kobo bigint not null default 0 check (balance_kobo >= 0),
  updated_at timestamptz not null default now()
);
insert into public.admin_wallet_balances(id,balance_kobo) values(1,0)
on conflict(id) do nothing;

create table if not exists public.admin_wallet_deposits (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  amount_kobo bigint not null check (amount_kobo between 10000 and 300000000),
  currency text not null default 'NGN' check(currency='NGN'),
  email text not null,
  status text not null default 'pending'
    check(status in ('pending','success','failed','reversed','initialization_failed')),
  paystack_transaction_id text unique,
  paystack_channel text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  amount_kobo bigint not null,
  transaction_type text not null check(transaction_type in ('deposit','debit','refund','adjustment')),
  description text not null,
  provider text,
  service_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_supplier_purchases (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  provider text not null,
  service_name text not null,
  supplier_order_id text,
  supplier_cost_kobo bigint not null check(supplier_cost_kobo > 0),
  status text not null default 'reserved'
    check(status in ('reserved','supplier_pending','pending','completed','failed','refund_pending','refunded')),
  supplier_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_supplier_purchases_created_idx
  on public.admin_supplier_purchases(created_at desc);

alter table public.admin_wallet_balances enable row level security;
alter table public.admin_wallet_deposits enable row level security;
alter table public.admin_wallet_transactions enable row level security;
alter table public.admin_supplier_purchases enable row level security;
revoke all on public.admin_wallet_balances, public.admin_wallet_deposits,
  public.admin_wallet_transactions, public.admin_supplier_purchases
  from public, anon, authenticated;
grant all on public.admin_wallet_balances, public.admin_wallet_deposits,
  public.admin_wallet_transactions, public.admin_supplier_purchases to service_role;

create or replace function public.bt_admin_personal_wallet_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_balance bigint;
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now())
    then raise exception 'ADMIN_SESSION_EXPIRED'; end if;
  select balance_kobo into v_balance from public.admin_wallet_balances where id=1;
  return jsonb_build_object(
    'balance',coalesce(v_balance,0)::numeric/100,
    'transactions',coalesce((select jsonb_agg(jsonb_build_object(
      'reference',reference,'amount',amount_kobo::numeric/100,
      'type',transaction_type,'description',description,'provider',provider,
      'service_name',service_name,'created_at',created_at
    ) order by created_at desc) from public.admin_wallet_transactions),'[]'::jsonb),
    'deposits',coalesce((select jsonb_agg(jsonb_build_object(
      'reference',reference,'amount',amount_kobo::numeric/100,'status',status,
      'email',email,'created_at',created_at,'paid_at',paid_at
    ) order by created_at desc) from public.admin_wallet_deposits),'[]'::jsonb),
    'purchases',coalesce((select jsonb_agg(jsonb_build_object(
      'reference',reference,'provider',provider,'service_name',service_name,
      'supplier_order_id',supplier_order_id,'supplier_cost',supplier_cost_kobo::numeric/100,
      'status',status,'created_at',created_at,'updated_at',updated_at
    ) order by created_at desc) from public.admin_supplier_purchases),'[]'::jsonb)
  );
end;
$function$;

create or replace function public.bt_admin_wallet_credit_deposit(
  p_token uuid,p_reference text,p_transaction_id text,p_channel text,
  p_paid_at timestamptz,p_amount_kobo bigint,p_currency text
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare d public.admin_wallet_deposits;
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now())
    then raise exception 'ADMIN_SESSION_EXPIRED'; end if;
  select * into d from public.admin_wallet_deposits where reference=p_reference for update;
  if d.id is null then raise exception 'ADMIN_DEPOSIT_NOT_FOUND'; end if;
  if d.amount_kobo<>p_amount_kobo or d.currency<>upper(p_currency) then
    raise exception 'ADMIN_DEPOSIT_AMOUNT_MISMATCH';
  end if;
  if d.status='success' then return jsonb_build_object('success',true,'already_credited',true); end if;
  if d.status<>'pending' then raise exception 'ADMIN_DEPOSIT_NOT_PENDING'; end if;
  update public.admin_wallet_deposits set status='success',
    paystack_transaction_id=p_transaction_id,paystack_channel=p_channel,
    paid_at=coalesce(p_paid_at,now()) where id=d.id;
  update public.admin_wallet_balances set balance_kobo=balance_kobo+d.amount_kobo,
    updated_at=now() where id=1;
  insert into public.admin_wallet_transactions(reference,amount_kobo,transaction_type,description)
    values(d.reference,d.amount_kobo,'deposit','Paystack administrator wallet funding');
  return jsonb_build_object('success',true,'already_credited',false);
end;
$function$;

-- Webhook variant: Paystack's signed server-to-server event has no browser admin token.
create or replace function public.bt_admin_wallet_credit_deposit_webhook(
  p_reference text,p_transaction_id text,p_channel text,
  p_paid_at timestamptz,p_amount_kobo bigint,p_currency text
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare d public.admin_wallet_deposits;
begin
  select * into d from public.admin_wallet_deposits where reference=p_reference for update;
  if d.id is null then raise exception 'ADMIN_DEPOSIT_NOT_FOUND'; end if;
  if d.amount_kobo<>p_amount_kobo or d.currency<>upper(p_currency) then
    raise exception 'ADMIN_DEPOSIT_AMOUNT_MISMATCH';
  end if;
  if d.status='success' then return jsonb_build_object('success',true,'already_credited',true); end if;
  if d.status<>'pending' then raise exception 'ADMIN_DEPOSIT_NOT_PENDING'; end if;
  update public.admin_wallet_deposits set status='success',
    paystack_transaction_id=p_transaction_id,paystack_channel=p_channel,
    paid_at=coalesce(p_paid_at,now()) where id=d.id;
  update public.admin_wallet_balances set balance_kobo=balance_kobo+d.amount_kobo,
    updated_at=now() where id=1;
  insert into public.admin_wallet_transactions(reference,amount_kobo,transaction_type,description)
    values(d.reference,d.amount_kobo,'deposit','Paystack administrator wallet funding');
  return jsonb_build_object('success',true,'already_credited',false);
end;
$function$;

create or replace function public.bt_admin_wallet_reserve_purchase(
  p_token uuid,p_reference text,p_provider text,p_service_name text,p_supplier_cost_kobo bigint
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_balance bigint; v_purchase public.admin_supplier_purchases;
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now())
    then raise exception 'ADMIN_SESSION_EXPIRED'; end if;
  if p_reference is null or length(p_reference)<12 or p_provider is null
     or p_service_name is null or p_supplier_cost_kobo<=0 then
    raise exception 'INVALID_ADMIN_PURCHASE';
  end if;
  select * into v_purchase from public.admin_supplier_purchases where reference=p_reference;
  if v_purchase.id is not null then
    return jsonb_build_object('purchase_id',v_purchase.id,'status',v_purchase.status,'already_reserved',true);
  end if;
  select balance_kobo into v_balance from public.admin_wallet_balances where id=1 for update;
  if coalesce(v_balance,0)<p_supplier_cost_kobo then raise exception 'INSUFFICIENT_ADMIN_WALLET_BALANCE'; end if;
  update public.admin_wallet_balances set balance_kobo=balance_kobo-p_supplier_cost_kobo,updated_at=now() where id=1;
  insert into public.admin_supplier_purchases(reference,provider,service_name,supplier_cost_kobo,status)
    values(p_reference,p_provider,p_service_name,p_supplier_cost_kobo,'reserved') returning * into v_purchase;
  insert into public.admin_wallet_transactions(reference,amount_kobo,transaction_type,description,provider,service_name)
    values(p_reference,-p_supplier_cost_kobo,'debit','Admin supplier purchase: '||p_service_name,p_provider,p_service_name);
  return jsonb_build_object('purchase_id',v_purchase.id,'status',v_purchase.status,'already_reserved',false);
end;
$function$;

create or replace function public.bt_admin_wallet_update_purchase(
  p_token uuid,p_reference text,p_supplier_order_id text,p_status text,p_supplier_response jsonb default null
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_purchase public.admin_supplier_purchases;
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now())
    then raise exception 'ADMIN_SESSION_EXPIRED'; end if;
  if p_status not in ('supplier_pending','pending','completed','failed','refund_pending','refunded') then
    raise exception 'INVALID_ADMIN_PURCHASE_STATUS';
  end if;
  select * into v_purchase from public.admin_supplier_purchases where reference=p_reference for update;
  if v_purchase.id is null then raise exception 'ADMIN_PURCHASE_NOT_FOUND'; end if;
  if v_purchase.status='refunded' then
    return jsonb_build_object('success',true,'status','refunded','already_refunded',true);
  end if;
  if p_status in ('failed','refunded') then
    if not exists(select 1 from public.admin_wallet_transactions where reference='refund-'||p_reference) then
      update public.admin_wallet_balances set balance_kobo=balance_kobo+v_purchase.supplier_cost_kobo,
        updated_at=now() where id=1;
      insert into public.admin_wallet_transactions(reference,amount_kobo,transaction_type,description,provider,service_name)
        values('refund-'||p_reference,v_purchase.supplier_cost_kobo,'refund',
          'Refund: admin supplier purchase '||v_purchase.service_name,v_purchase.provider,v_purchase.service_name);
    end if;
    p_status:='refunded';
  end if;
  update public.admin_supplier_purchases set supplier_order_id=coalesce(p_supplier_order_id,supplier_order_id),
    status=p_status,supplier_response=coalesce(p_supplier_response,supplier_response),updated_at=now()
    where id=v_purchase.id;
  return jsonb_build_object('success',true,'status',p_status);
end;
$function$;

revoke all on function public.bt_admin_personal_wallet_get(uuid) from public,anon,authenticated;
revoke all on function public.bt_admin_wallet_credit_deposit(uuid,text,text,text,timestamptz,bigint,text) from public,anon,authenticated;
revoke all on function public.bt_admin_wallet_reserve_purchase(uuid,text,text,text,bigint) from public,anon,authenticated;
revoke all on function public.bt_admin_wallet_update_purchase(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bt_admin_personal_wallet_get(uuid) to service_role;
grant execute on function public.bt_admin_wallet_credit_deposit(uuid,text,text,text,timestamptz,bigint,text) to service_role;
revoke all on function public.bt_admin_wallet_credit_deposit_webhook(text,text,text,timestamptz,bigint,text) from public,anon,authenticated;
grant execute on function public.bt_admin_wallet_credit_deposit_webhook(text,text,text,timestamptz,bigint,text) to service_role;
grant execute on function public.bt_admin_wallet_reserve_purchase(uuid,text,text,text,bigint) to service_role;
grant execute on function public.bt_admin_wallet_update_purchase(uuid,text,text,text,jsonb) to service_role;

commit;
