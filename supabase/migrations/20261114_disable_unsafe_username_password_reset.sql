-- Disable the unsafe username-only password reset.
-- Customer accounts have no email; username alone is not proof of identity.
begin;
create or replace function public.bt_customer_forgot_password(p_name text, p_new_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'Password reset is temporarily unavailable. Please contact the administrator to verify your identity and reset your code securely.';
end;
$function$;
revoke all on function public.bt_customer_forgot_password(text, text) from public, anon, authenticated;
commit;
