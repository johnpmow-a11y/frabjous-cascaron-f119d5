-- All Ads Manager: customer-only email OTP password recovery.
-- The customer proves ownership through the registered email address.
-- No administrator password-reset function is available after this migration.
begin;

create table if not exists public.customer_contact_emails (
  customer_id text primary key,
  email text not null,
  updated_at timestamptz not null default now()
);
alter table public.customer_contact_emails enable row level security;
revoke all on public.customer_contact_emails from public, anon, authenticated;

create or replace function public.bt_customer_set_email(p_token text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_customer_id text;
begin
  if p_email is null or length(trim(p_email)) < 6
     or trim(p_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$' then
    raise exception 'Enter a valid email address.';
  end if;
  select customer_id::text into v_customer_id
  from public.customer_sessions
  where token::text = p_token and expires_at > now()
  limit 1;
  if v_customer_id is null then raise exception 'Invalid or expired customer session.'; end if;
  insert into public.customer_contact_emails(customer_id,email,updated_at)
  values(v_customer_id,lower(trim(p_email)),now())
  on conflict(customer_id) do update set email=excluded.email,updated_at=now();
  return jsonb_build_object('ok',true,'email',lower(trim(p_email)));
end;
$$;
revoke all on function public.bt_customer_set_email(text,text) from public;
grant execute on function public.bt_customer_set_email(text,text) to anon, authenticated;

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
declare v_result jsonb;
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
  p_customer_id uuid, p_new_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare c public.customers; t uuid; st uuid; a public.bt_customer_access;
begin
  if p_new_code is null or p_new_code !~ '^[0-9]{4}$' then
    raise exception 'The new security code must contain exactly four digits';
  end if;
  update public.customers
     set code_hash = extensions.crypt(p_new_code, extensions.gen_salt('bf'))
   where id = p_customer_id returning * into c;
  if c.id is null then raise exception 'Customer account not found'; end if;
  delete from public.customer_password_reset_requests where customer_id = c.id;
  delete from public.customer_sessions where customer_id = c.id;
  delete from public.bt_subscription_sessions where customer_id = c.id;
  select * into a from public.bt_customer_access where customer_id = c.id;
  if coalesce(a.is_locked, false)
     or (a.subscription_expires_at is not null and a.subscription_expires_at <= now()) then
    insert into public.bt_subscription_sessions(customer_id) values (c.id) returning token into st;
    return jsonb_build_object('locked', true, 'id', c.id, 'name', c.name, 'subscription_token', st);
  end if;
  insert into public.customer_sessions(customer_id) values (c.id) returning token into t;
  return jsonb_build_object('locked', false, 'id', c.id, 'name', c.name, 'token', t);
end;
$function$;
revoke all on function public.bt_customer_password_reset_complete(uuid,text) from public, anon, authenticated;
grant execute on function public.bt_customer_password_reset_complete(uuid,text) to service_role;

-- Remove administrator ability to reset customer codes.
drop function if exists public.bt_admin_reset_customer_code(text,uuid,text);

commit;
