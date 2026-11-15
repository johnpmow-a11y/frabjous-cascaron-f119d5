-- Customer email addresses for All Ads Manager accounts.
-- Run once in Supabase SQL Editor.
create table if not exists public.customer_contact_emails (
  customer_id text primary key,
  email text not null,
  updated_at timestamptz not null default now()
);
alter table public.customer_contact_emails enable row level security;

create or replace function public.bt_customer_set_email(p_token text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_customer_id text;
begin
  if p_email is null or length(trim(p_email)) < 6 or trim(p_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$' then
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

create or replace function public.bt_customer_email_get(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_customer_id text; v_email text;
begin
  select customer_id::text into v_customer_id
  from public.customer_sessions
  where token::text = p_token and expires_at > now()
  limit 1;
  if v_customer_id is null then raise exception 'Invalid or expired customer session.'; end if;
  select email into v_email from public.customer_contact_emails where customer_id=v_customer_id;
  return v_email;
end;
$$;

create or replace function public.bt_admin_customer_emails(p_token text)
returns table(customer_id text,email text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists(select 1 from public.admin_sessions where token::text=p_token and expires_at>now()) then
    raise exception 'Invalid or expired administrator session.';
  end if;
  return query select e.customer_id,e.email from public.customer_contact_emails e;
end;
$$;

revoke all on public.customer_contact_emails from anon, authenticated;
grant execute on function public.bt_customer_set_email(text,text) to anon, authenticated;
grant execute on function public.bt_customer_email_get(text) to anon, authenticated;
grant execute on function public.bt_admin_customer_emails(text) to anon, authenticated;
