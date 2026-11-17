-- All Ads Manager: administrator-assisted customer security-code reset.
-- Email OTP recovery is no longer used. Only a valid administrator session may reset a code.
begin;

create or replace function public.bt_admin_reset_customer_code(
  p_token text,
  p_customer_id uuid,
  p_new_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_name text;
begin
  if p_token is null or p_token !~* '^[0-9a-f-]{36}$' then
    raise exception 'Administrator session is invalid.';
  end if;
  if p_new_code is null or p_new_code !~ '^[0-9]{4}$' then
    raise exception 'The new security code must contain exactly four digits.';
  end if;
  if not exists (
    select 1 from public.admin_sessions
    where token::text = p_token and expires_at > now()
  ) then
    raise exception 'Administrator session expired. Please sign in again.';
  end if;

  update public.customers
     set code_hash = extensions.crypt(p_new_code, extensions.gen_salt('bf'))
   where id = p_customer_id
   returning name into v_name;

  if v_name is null then
    raise exception 'Customer account not found.';
  end if;

  delete from public.customer_sessions where customer_id = p_customer_id;
  delete from public.bt_subscription_sessions where customer_id = p_customer_id;

  return jsonb_build_object('ok', true, 'customer_name', v_name);
end;
$function$;

revoke all on function public.bt_admin_reset_customer_code(text,uuid,text) from public;
grant execute on function public.bt_admin_reset_customer_code(text,uuid,text) to anon, authenticated, service_role;

commit;
