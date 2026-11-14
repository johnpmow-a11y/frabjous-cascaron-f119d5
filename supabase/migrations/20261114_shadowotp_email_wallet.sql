-- All Ads Manager: Shadow OTP temporary-email wallet orders.
-- Additive migration: keeps existing WhatsApp/UltraSMS orders and wallet functions unchanged.
begin;

create table if not exists public.shadowotp_email_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  wallet_reference text not null unique,
  supplier_email_id text unique,
  server integer not null check (server in (1,2)),
  service_code text not null,
  service_name text not null,
  domain text not null,
  email_address text,
  supplier_price_pkr numeric(14,2) not null check (supplier_price_pkr > 0),
  fx_ngn_per_pkr numeric(14,6) not null check (fx_ngn_per_pkr > 0),
  markup_ngn_kobo bigint not null default 100000 check (markup_ngn_kobo = 100000),
  supplier_cost_kobo bigint not null check (supplier_cost_kobo > 0),
  customer_charge_kobo bigint not null check (customer_charge_kobo > 0),
  status text not null default 'supplier_pending'
    check (status in ('supplier_pending','waiting','received','cancelled','failed','refund_pending')),
  otp_code text,
  message_subject text,
  message_body text,
  cancel_wait_seconds integer,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shadowotp_email_customer_created_idx
  on public.shadowotp_email_orders(customer_id, created_at desc);
alter table public.shadowotp_email_orders enable row level security;
revoke all on public.shadowotp_email_orders from public, anon, authenticated;
grant all on public.shadowotp_email_orders to service_role;

create or replace function public.bt_shadowotp_reserve_email_order(
  p_token uuid, p_reference text, p_server integer, p_service_code text,
  p_service_name text, p_domain text, p_supplier_price_pkr numeric,
  p_fx_ngn_per_pkr numeric
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_customer uuid; v_balance bigint; v_supplier bigint; v_charge bigint;
  v_order public.shadowotp_email_orders;
begin
  select customer_id into v_customer from public.customer_sessions
    where token=p_token and expires_at>now();
  if v_customer is null then raise exception 'CUSTOMER_SESSION_EXPIRED'; end if;
  if p_server not in (1,2) or p_supplier_price_pkr<=0 or p_fx_ngn_per_pkr<=0 then
    raise exception 'INVALID_PRICING';
  end if;
  v_supplier := round(p_supplier_price_pkr * p_fx_ngn_per_pkr * 100)::bigint;
  v_charge := v_supplier + 100000; -- fixed ₦1,000 markup
  if v_supplier<=0 or v_charge<=0 then raise exception 'INVALID_PRICING'; end if;
  insert into public.wallet_balances(customer_id,balance_kobo) values(v_customer,0)
    on conflict(customer_id) do nothing;
  select balance_kobo into v_balance from public.wallet_balances
    where customer_id=v_customer for update;
  if v_balance<v_charge then raise exception 'INSUFFICIENT_WALLET_BALANCE'; end if;
  update public.wallet_balances set balance_kobo=balance_kobo-v_charge,updated_at=now()
    where customer_id=v_customer;
  insert into public.wallet_transactions(customer_id,reference,amount_kobo,transaction_type,description)
    values(v_customer,p_reference,-v_charge,'debit','Shadow OTP temporary email purchase');
  insert into public.shadowotp_email_orders(
    customer_id,wallet_reference,server,service_code,service_name,domain,
    supplier_price_pkr,fx_ngn_per_pkr,markup_ngn_kobo,supplier_cost_kobo,
    customer_charge_kobo,status
  ) values(
    v_customer,p_reference,p_server,p_service_code,p_service_name,p_domain,
    p_supplier_price_pkr,p_fx_ngn_per_pkr,100000,v_supplier,v_charge,'supplier_pending'
  ) returning * into v_order;
  return jsonb_build_object('order_id',v_order.id,'customer_charge_kobo',v_charge,'status',v_order.status);
end;
$function$;

create or replace function public.bt_shadowotp_update_email_order(
  p_order_id uuid, p_supplier_email_id text default null,
  p_email_address text default null, p_status text default null,
  p_otp_code text default null, p_message_subject text default null,
  p_message_body text default null, p_cancel_wait_seconds integer default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_order public.shadowotp_email_orders; v_status text;
begin
  select * into v_order from public.shadowotp_email_orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  v_status:=coalesce(p_status,v_order.status);
  if v_status not in ('supplier_pending','waiting','received','cancelled','failed','refund_pending') then
    raise exception 'INVALID_ORDER_STATUS';
  end if;
  update public.shadowotp_email_orders set
    supplier_email_id=coalesce(p_supplier_email_id,supplier_email_id),
    email_address=coalesce(p_email_address,email_address),status=v_status,
    otp_code=coalesce(p_otp_code,otp_code),
    message_subject=coalesce(p_message_subject,message_subject),
    message_body=coalesce(p_message_body,message_body),
    cancel_wait_seconds=p_cancel_wait_seconds,updated_at=now()
    where id=p_order_id returning * into v_order;
  if v_status in ('cancelled','failed') and v_order.refunded_at is null then
    update public.wallet_balances set balance_kobo=balance_kobo+v_order.customer_charge_kobo,updated_at=now()
      where customer_id=v_order.customer_id;
    insert into public.wallet_transactions(customer_id,reference,amount_kobo,transaction_type,description)
      values(v_order.customer_id,'refund-'||v_order.wallet_reference,v_order.customer_charge_kobo,
        'refund','Refund for unsuccessful Shadow OTP temporary email');
    update public.shadowotp_email_orders set refunded_at=now(),updated_at=now()
      where id=p_order_id returning * into v_order;
  end if;
  return jsonb_build_object('id',v_order.id,'status',v_order.status,'email',v_order.email_address,
    'code',v_order.otp_code,'subject',v_order.message_subject,'body',v_order.message_body,
    'refunded',v_order.refunded_at is not null,'server',v_order.server,
    'cancel_wait_seconds',v_order.cancel_wait_seconds,
    'customer_charge_kobo',v_order.customer_charge_kobo);
end;
$function$;

revoke all on function public.bt_shadowotp_reserve_email_order(uuid,text,integer,text,text,text,numeric,numeric) from public,anon,authenticated;
revoke all on function public.bt_shadowotp_update_email_order(uuid,text,text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.bt_shadowotp_reserve_email_order(uuid,text,integer,text,text,text,numeric,numeric) to service_role;
grant execute on function public.bt_shadowotp_update_email_order(uuid,text,text,text,text,text,text,integer) to service_role;
commit;
