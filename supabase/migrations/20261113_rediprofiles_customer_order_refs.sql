-- Expose stable order references to the authenticated customer's order history.
begin;
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
      'id',id,'external_customer_ref',external_customer_ref,
      'supplier_order_id',supplier_order_id,'service_name',service_name,
      'supplier_service_id',supplier_service_id,
      'supplier_price',supplier_price_kobo::numeric/100,
      'customer_price',customer_price_kobo::numeric/100,'status',status,
      'account_data',account_data,'created_at',created_at,'updated_at',updated_at
    ) order by created_at desc)
    from public.rediprofiles_customer_orders where customer_id=v_customer_id
  ),'[]'::jsonb);
end;
$function$;
revoke all on function public.bt_customer_rediprofiles_orders_get(uuid) from public,anon,authenticated;
grant execute on function public.bt_customer_rediprofiles_orders_get(uuid) to anon,authenticated,service_role;
commit;
