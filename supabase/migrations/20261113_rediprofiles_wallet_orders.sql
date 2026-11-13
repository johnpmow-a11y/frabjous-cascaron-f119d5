-- Rediprofiles ready-made account marketplace: atomic wallet debit/refund and customer order history.
begin;

create table if not exists public.rediprofiles_customer_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  external_customer_ref text not null unique,
  supplier_service_id text not null,
  supplier_order_id text unique,
  service_name text not null,
  supplier_price_kobo bigint not null check (supplier_price_kobo > 0),
  customer_price_kobo bigint not null check (customer_price_kobo > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  status text not null default 'processing' check (status in ('processing','pending','pre_ordered','completed','failed','refund_pending','refunded')),
  account_data jsonb,
  supplier_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rediprofiles_customer_orders_customer_created_idx
  on public.rediprofiles_customer_orders(customer_id, created_at desc);

alter table public.rediprofiles_customer_orders enable row level security;
revoke all on public.rediprofiles_customer_orders from public, anon, authenticated;
grant all on public.rediprofiles_customer_orders to service_role;

create or replace function public.bt_rediprofiles_reserve_order(
  p_token uuid,
  p_external_customer_ref text,
  p_supplier_service_id text,
  p_service_name text,
  p_supplier_price_kobo bigint,
  p_customer_price_kobo bigint
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_customer_id uuid;
  v_balance bigint;
  v_existing public.rediprofiles_customer_orders;
  v_order public.rediprofiles_customer_orders;
begin
  select customer_id into v_customer_id
  from public.customer_sessions
  where token = p_token and expires_at > now();
  if v_customer_id is null then raise exception 'CUSTOMER_SESSION_EXPIRED'; end if;

  if p_external_customer_ref is null or length(p_external_customer_ref) < 12
     or p_supplier_service_id is null or p_service_name is null
     or p_supplier_price_kobo <= 0 or p_customer_price_kobo < p_supplier_price_kobo then
    raise exception 'INVALID_ORDER_DETAILS';
  end if;

  select * into v_existing from public.rediprofiles_customer_orders
  where external_customer_ref = p_external_customer_ref;
  if v_existing.id is not null then
    if v_existing.customer_id <> v_customer_id then raise exception 'ORDER_REFERENCE_CONFLICT'; end if;
    return jsonb_build_object('order_id',v_existing.id,'status',v_existing.status,'already_reserved',true);
  end if;

  insert into public.wallet_balances(customer_id,balance_kobo)
  values(v_customer_id,0) on conflict(customer_id) do nothing;
  select balance_kobo into v_balance from public.wallet_balances
  where customer_id=v_customer_id for update;

  if coalesce(v_balance,0) < p_customer_price_kobo then
    raise exception 'INSUFFICIENT_WALLET_BALANCE';
  end if;

  insert into public.rediprofiles_customer_orders(
    customer_id,external_customer_ref,supplier_service_id,service_name,
    supplier_price_kobo,customer_price_kobo,status
  ) values (
    v_customer_id,p_external_customer_ref,p_supplier_service_id,p_service_name,
    p_supplier_price_kobo,p_customer_price_kobo,'processing'
  ) returning * into v_order;

  update public.wallet_balances
  set balance_kobo=balance_kobo-p_customer_price_kobo,updated_at=now()
  where customer_id=v_customer_id;

  insert into public.wallet_transactions(
    customer_id,reference,amount_kobo,transaction_type,description
  ) values (
    v_customer_id,p_external_customer_ref,-p_customer_price_kobo,'debit',
    'Ready-made account purchase: '||p_service_name
  );

  return jsonb_build_object('order_id',v_order.id,'status',v_order.status,'already_reserved',false);
end;
$function$;

create or replace function public.bt_rediprofiles_complete_order(
  p_external_customer_ref text,
  p_supplier_order_id text,
  p_status text,
  p_account_data jsonb,
  p_supplier_response jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_order public.rediprofiles_customer_orders;
begin
  if p_status not in ('pending','pre_ordered','completed','failed','refund_pending','refunded') then
    raise exception 'INVALID_SUPPLIER_ORDER_STATUS';
  end if;
  select * into v_order from public.rediprofiles_customer_orders
  where external_customer_ref=p_external_customer_ref for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  update public.rediprofiles_customer_orders
  set supplier_order_id=coalesce(p_supplier_order_id,supplier_order_id),
      status=p_status,
      account_data=coalesce(p_account_data,account_data),
      supplier_response=coalesce(p_supplier_response,supplier_response),
      updated_at=now()
  where id=v_order.id;
  return jsonb_build_object('order_id',v_order.id,'status',p_status);
end;
$function$;

create or replace function public.bt_rediprofiles_refund_order(
  p_external_customer_ref text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_order public.rediprofiles_customer_orders;
begin
  select * into v_order from public.rediprofiles_customer_orders
  where external_customer_ref=p_external_customer_ref for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status='refunded' then
    return jsonb_build_object('success',true,'already_refunded',true);
  end if;
  if v_order.status not in ('processing','pending','pre_ordered','refund_pending','failed') then
    raise exception 'ORDER_NOT_REFUNDABLE';
  end if;

  update public.wallet_balances
  set balance_kobo=balance_kobo+v_order.customer_price_kobo,updated_at=now()
  where customer_id=v_order.customer_id;

  insert into public.wallet_transactions(
    customer_id,reference,amount_kobo,transaction_type,description
  ) values (
    v_order.customer_id,v_order.external_customer_ref||'-refund',
    v_order.customer_price_kobo,'refund',
    'Refund: ready-made account order ('||left(coalesce(p_reason,'supplier failed'),180)||')'
  ) on conflict(reference) do nothing;

  update public.rediprofiles_customer_orders
  set status='refunded',updated_at=now()
  where id=v_order.id;
  return jsonb_build_object('success',true,'already_refunded',false);
end;
$function$;

create or replace function public.bt_customer_rediprofiles_orders_get(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_customer_id uuid;
begin
  select customer_id into v_customer_id from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_customer_id is null then raise exception 'Invalid or expired customer session'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',id,'service_name',service_name,'supplier_service_id',supplier_service_id,
      'customer_price',customer_price_kobo::numeric/100,'status',status,
      'account_data',account_data,'created_at',created_at,'updated_at',updated_at
    ) order by created_at desc)
    from public.rediprofiles_customer_orders where customer_id=v_customer_id
  ),'[]'::jsonb);
end;
$function$;

revoke all on function public.bt_rediprofiles_reserve_order(uuid,text,text,text,bigint,bigint) from public,anon,authenticated;
revoke all on function public.bt_rediprofiles_complete_order(text,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.bt_rediprofiles_refund_order(text,text) from public,anon,authenticated;
revoke all on function public.bt_customer_rediprofiles_orders_get(uuid) from public,anon,authenticated;
grant execute on function public.bt_rediprofiles_reserve_order(uuid,text,text,text,bigint,bigint) to service_role;
grant execute on function public.bt_rediprofiles_complete_order(text,text,text,jsonb,jsonb) to service_role;
grant execute on function public.bt_rediprofiles_refund_order(text,text) to service_role;
grant execute on function public.bt_customer_rediprofiles_orders_get(uuid) to anon,authenticated;

commit;
