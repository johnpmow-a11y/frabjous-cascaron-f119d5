-- Permit secure administrator-originated calls without impersonating a customer.
begin;
alter table public.aam_calls alter column caller_id drop not null;
alter table public.aam_calls
  add column if not exists caller_role text not null default 'customer',
  add column if not exists admin_session_hash text;
alter table public.aam_calls
  drop constraint if exists aam_calls_caller_identity_check;
alter table public.aam_calls
  add constraint aam_calls_caller_identity_check
  check (
    (caller_role = 'customer' and caller_id is not null and admin_session_hash is null)
    or
    (caller_role = 'admin' and caller_id is null and admin_session_hash is not null)
  );
create index if not exists aam_calls_admin_session_active_idx
  on public.aam_calls(admin_session_hash, status)
  where caller_role = 'admin';
commit;
