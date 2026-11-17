-- Correct future Shadow OTP temporary-email orders to the agreed fixed ₦1,200 markup.
-- Existing completed orders retain their original recorded pricing.
begin;

alter table public.shadowotp_email_orders
  alter column markup_ngn_kobo set default 120000;

alter table public.shadowotp_email_orders
  drop constraint if exists shadowotp_email_orders_markup_ngn_kobo_check;

alter table public.shadowotp_email_orders
  add constraint shadowotp_email_orders_markup_ngn_kobo_check
  check (markup_ngn_kobo = 120000);

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
  v_charge := v_supplier + 120000; -- fixed ₦1,200 markup
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
    p_supplier_price_pkr,p_fx_ngn_per_pkr,120000,v_supplier,v_charge,'supplier_pending'
  ) returning * into v_order;
  return jsonb_build_object('order_id',v_order.id,'customer_charge_kobo',v_charge,'status',v_order.status);
end;
$function$;

revoke all on function public.bt_shadowotp_reserve_email_order(uuid,text,integer,text,text,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.bt_shadowotp_reserve_email_order(uuid,text,integer,text,text,text,numeric,numeric) to service_role;

commit;
