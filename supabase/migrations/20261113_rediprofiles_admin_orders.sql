-- Admin-only Rediprofiles order list, authenticated using the existing admin session RPC.
begin;
create or replace function public.bt_admin_rediprofiles_orders_get(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_auth jsonb;
begin
  v_auth := public.bt_admin_get(p_token);
  if v_auth is null then raise exception 'ADMIN_SESSION_EXPIRED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',o.id,'customer_id',o.customer_id,'customer_name',c.name,
      'external_customer_ref',o.external_customer_ref,'supplier_service_id',o.supplier_service_id,
      'supplier_order_id',o.supplier_order_id,'service_name',o.service_name,
      'supplier_price',o.supplier_price_kobo::numeric/100,
      'customer_price',o.customer_price_kobo::numeric/100,'status',o.status,
      'account_data',o.account_data,'created_at',o.created_at,'updated_at',o.updated_at
    ) order by o.created_at desc)
    from public.rediprofiles_customer_orders o
    join public.customers c on c.id=o.customer_id
  ),'[]'::jsonb);
end;
$function$;
revoke all on function public.bt_admin_rediprofiles_orders_get(uuid) from public,anon,authenticated;
grant execute on function public.bt_admin_rediprofiles_orders_get(uuid) to service_role;
commit;
