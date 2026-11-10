-- Add username-only customer four-digit code reset.
-- This intentionally follows the owner's requested recovery policy:
-- possession of the exact username is sufficient to reset the code.
-- Existing customer/admin login methods and email delivery are unchanged.

begin;

create or replace function public.bt_customer_forgot_password(
  p_name text,
  p_new_code text
)
returns json
language plpgsql
security definer
set search_path = ''
as $function$
declare
  c public.customers;
  t uuid;
  st uuid;
  a public.bt_customer_access;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Enter your username';
  end if;

  if p_new_code is null or p_new_code !~ '^[0-9]{4}$' then
    raise exception 'The new security code must contain exactly four digits';
  end if;

  select * into c
  from public.customers
  where lower(name) = lower(trim(p_name))
  limit 1
  for update;

  if c.id is null then
    raise exception 'Username not found';
  end if;

  update public.customers
  set code_hash = extensions.crypt(p_new_code, extensions.gen_salt('bf'))
  where id = c.id;

  -- Revoke sessions created with the previous four-digit code.
  delete from public.customer_sessions where customer_id = c.id;
  delete from public.bt_subscription_sessions where customer_id = c.id;

  select * into a
  from public.bt_customer_access
  where customer_id = c.id;

  if coalesce(a.is_locked, false)
     or (a.subscription_expires_at is not null and a.subscription_expires_at <= now()) then
    insert into public.bt_subscription_sessions(customer_id)
    values (c.id)
    returning token into st;

    return json_build_object(
      'locked', true,
      'id', c.id,
      'name', c.name,
      'subscription_token', st
    );
  end if;

  insert into public.customer_sessions(customer_id)
  values (c.id)
  returning token into t;

  return json_build_object(
    'locked', false,
    'id', c.id,
    'name', c.name,
    'token', t
  );
end;
$function$;

revoke all on function public.bt_customer_forgot_password(text, text) from public;
grant execute on function public.bt_customer_forgot_password(text, text) to anon, authenticated;

commit;
