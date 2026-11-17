-- Fix email validation for customer account email storage.
-- [.] matches a literal dot without backslash-escaping ambiguity in PostgreSQL.

create or replace function public.bt_customer_set_email(p_token text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_customer_id text;
begin
  if p_email is null
     or length(trim(p_email)) < 6
     or trim(p_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$' then
    raise exception 'Enter a valid email address.';
  end if;

  select customer_id::text into v_customer_id
  from public.customer_sessions
  where token::text = p_token and expires_at > now()
  limit 1;

  if v_customer_id is null then
    raise exception 'Invalid or expired customer session.';
  end if;

  insert into public.customer_contact_emails(customer_id,email,updated_at)
  values(v_customer_id,lower(trim(p_email)),now())
  on conflict(customer_id) do update
    set email=excluded.email,updated_at=now();

  return jsonb_build_object('ok',true,'email',lower(trim(p_email)));
end;
$$;

revoke all on function public.bt_customer_set_email(text,text) from public;
grant execute on function public.bt_customer_set_email(text,text) to anon, authenticated;
