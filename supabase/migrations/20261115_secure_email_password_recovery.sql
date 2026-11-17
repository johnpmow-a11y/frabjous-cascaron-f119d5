-- All Ads Manager: secure customer four-digit code recovery by registered email.
begin;

create table if not exists public.customer_password_reset_requests (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default now()
);
alter table public.customer_password_reset_requests enable row level security;
revoke all on public.customer_password_reset_requests from public, anon, authenticated;
grant all on public.customer_password_reset_requests to service_role;

create or replace function public.bt_customer_password_reset_lookup(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object('id', c.id, 'name', c.name, 'email', e.email)
    into v_result
  from public.customers c
  join public.customer_contact_emails e on e.customer_id = c.id::text
  where lower(c.name) = lower(trim(p_name))
  limit 1;
  return v_result;
end;
$function$;

revoke all on function public.bt_customer_password_reset_lookup(text) from public, anon, authenticated;
grant execute on function public.bt_customer_password_reset_lookup(text) to service_role;

create or replace function public.bt_customer_password_reset_complete(
  p_customer_id uuid,
  p_new_code text
) returns jsonb
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
  if p_new_code is null or p_new_code !~ '^[0-9]{4}$' then
    raise exception 'The new security code must contain exactly four digits';
  end if;

  delete from public.customer_password_reset_requests
  where customer_id = p_customer_id;

  update public.customers
  set code_hash = extensions.crypt(p_new_code, extensions.gen_salt('bf'))
  where id = p_customer_id
  returning * into c;

  if c.id is null then raise exception 'Customer account not found'; end if;

  delete from public.customer_sessions where customer_id = c.id;
  delete from public.bt_subscription_sessions where customer_id = c.id;

  select * into a from public.bt_customer_access where customer_id = c.id;

  if coalesce(a.is_locked, false)
     or (a.subscription_expires_at is not null and a.subscription_expires_at <= now()) then
    insert into public.bt_subscription_sessions(customer_id)
    values (c.id) returning token into st;
    return jsonb_build_object('locked', true, 'id', c.id, 'name', c.name, 'subscription_token', st);
  end if;

  insert into public.customer_sessions(customer_id)
  values (c.id) returning token into t;
  return jsonb_build_object('locked', false, 'id', c.id, 'name', c.name, 'token', t);
end;
$function$;

revoke all on function public.bt_customer_password_reset_complete(uuid,text) from public, anon, authenticated;
grant execute on function public.bt_customer_password_reset_complete(uuid,text) to service_role;

commit;
