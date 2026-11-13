-- Remove the unsafe username-only four-digit code reset.
-- Customer code recovery must be verified by an administrator; knowing a username is not proof of ownership.
begin;
drop function if exists public.bt_customer_forgot_password(text, text);
commit;
