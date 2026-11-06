-- Align the website login with the per-customer lock implementation.
-- Apply in the existing Supabase project after the customer-lock migration.
-- Does not alter customer credentials, administrator login, or email delivery.

begin;

-- Locked/expired customers use a restricted subscription token, never a normal session.
create or replace function public.bt_customer_login(p_name text, p_code text)
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
  select * into c
  from public.customers
  where lower(name) = lower(trim(p_name))
  limit 1;

  if c.id is null or extensions.crypt(p_code, c.code_hash) <> c.code_hash then
    raise exception 'Account not found';
  end if;

  select * into a from public.bt_customer_access where customer_id = c.id;

  if coalesce(a.is_locked, false)
     or (a.subscription_expires_at is not null and a.subscription_expires_at <= now()) then
    insert into public.bt_subscription_sessions(customer_id)
    values (c.id) returning token into st;
    return json_build_object('locked', true, 'id', c.id, 'name', c.name,
                             'subscription_token', st);
  end if;

  insert into public.customer_sessions(customer_id) values (c.id) returning token into t;
  return json_build_object('locked', false, 'id', c.id, 'name', c.name, 'token', t);
end;
$function$;

-- The website's locked-account page uses a restricted subscription token.
-- Preserve the existing plan prices and save the correct amount for admin review.
create or replace function public.bt_customer_request_subscription(p_token uuid, p_weeks integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_customer_id uuid;
  v_amount numeric(12,2);
  v_request_id uuid;
  v_bank jsonb;
begin
  if p_weeks not between 1 and 4 then
    raise exception 'Choose a subscription duration from 1 to 4 weeks';
  end if;

  select customer_id into v_customer_id
  from public.bt_subscription_sessions
  where token = p_token and expires_at > now();
  if v_customer_id is null then
    raise exception 'Subscription session expired. Please log in again.';
  end if;

  if not exists (
    select 1 from public.bt_customer_access a
    where a.customer_id = v_customer_id
      and (a.is_locked or (a.subscription_expires_at is not null and a.subscription_expires_at <= now()))
  ) then
    raise exception 'This account does not currently require a subscription';
  end if;

  v_amount := case p_weeks when 1 then 3800 when 2 then 7600 when 3 then 11400 when 4 then 15200 end;
  insert into public.bt_subscription_requests(customer_id, plan_weeks, amount)
  values (v_customer_id, p_weeks, v_amount)
  returning id into v_request_id;

  delete from public.bt_subscription_sessions where token = p_token;
  select bank into v_bank from public.business_tools_settings where id = 1;

  return jsonb_build_object('success', true, 'request_id', v_request_id,
    'weeks', p_weeks, 'amount', v_amount, 'bank', v_bank, 'status', 'Pending');
end;
$function$;

revoke all on function public.bt_customer_login(text,text) from public;
grant execute on function public.bt_customer_login(text,text) to anon, authenticated;
revoke all on function public.bt_customer_request_subscription(uuid,integer) from public;
grant execute on function public.bt_customer_request_subscription(uuid,integer) to anon, authenticated;

commit;
