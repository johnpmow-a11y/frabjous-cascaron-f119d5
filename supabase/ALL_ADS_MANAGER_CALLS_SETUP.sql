-- All Ads Manager: complete LiveKit calling database setup
-- Run this single script once in Supabase SQL Editor before enabling calling.
-- It combines the four ordered call migrations in one transaction.
-- It repairs stale active-call rows before creating the uniqueness safeguards.

begin;

-- SECTION 1: supabase/migrations/20261119100000_livekit_call_tables.sql
-- Call records used to authorize LiveKit room tokens and track invitations.

create table if not exists public.aam_calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references public.customers(id) on delete cascade,
  call_type text not null check (call_type in ('audio','video')),
  status text not null default 'active' check (status in ('active','ended','missed','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.aam_call_participants (
  call_id uuid not null references public.aam_calls(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  role text not null check (role in ('caller','callee')),
  status text not null default 'invited' check (status in ('invited','accepted','declined','ended')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (call_id, customer_id)
);

create index if not exists aam_call_participants_customer_status_idx
  on public.aam_call_participants(customer_id, status, invited_at desc);
create index if not exists aam_calls_status_created_idx
  on public.aam_calls(status, created_at desc);

alter table public.aam_calls enable row level security;
alter table public.aam_call_participants enable row level security;

revoke all on public.aam_calls from anon, authenticated;
revoke all on public.aam_call_participants from anon, authenticated;
grant all on public.aam_calls to service_role;
grant all on public.aam_call_participants to service_role;

-- SECTION 2: supabase/migrations/20261119190000_admin_livekit_call_identity.sql
-- Permit secure administrator-originated calls without impersonating a customer.

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

-- SECTION 3: supabase/migrations/20261119200000_livekit_one_active_call_per_customer.sql
-- Enforce one active call per customer even when two devices tap Call at once.

-- Repair stale participant rows left by earlier terminal calls.
update public.aam_call_participants p
set status = 'ended'
from public.aam_calls c
where c.id = p.call_id
  and c.status <> 'active'
  and p.status in ('invited', 'accepted');

-- If earlier versions or concurrent requests created overlapping active calls,
-- keep the newest call for each customer and close their older participation.
with ranked as (
  select
    p.call_id,
    p.customer_id,
    row_number() over (
      partition by p.customer_id
      order by c.created_at desc, p.invited_at desc, p.call_id desc
    ) as position
  from public.aam_call_participants p
  join public.aam_calls c on c.id = p.call_id
  where c.status = 'active'
    and p.status in ('invited', 'accepted')
)
update public.aam_call_participants p
set status = 'ended'
from ranked r
where r.position > 1
  and p.call_id = r.call_id
  and p.customer_id = r.customer_id
  and p.status in ('invited', 'accepted');

-- Close customer calls that no longer have both participants, and admin calls
-- whose customer participant was removed during overlap repair.
update public.aam_calls c
set status = 'ended',
    ended_at = coalesce(c.ended_at, now()),
    updated_at = now()
where c.status = 'active'
  and (
    (c.caller_role = 'customer' and (
      select count(*) from public.aam_call_participants p
      where p.call_id = c.id and p.status in ('invited', 'accepted')
    ) < 2)
    or
    (c.caller_role = 'admin' and not exists (
      select 1 from public.aam_call_participants p
      where p.call_id = c.id and p.status in ('invited', 'accepted')
    ))
  );

update public.aam_call_participants p
set status = 'ended'
from public.aam_calls c
where c.id = p.call_id
  and c.status <> 'active'
  and p.status in ('invited', 'accepted');

create unique index if not exists aam_call_participants_one_active_call_per_customer_idx
  on public.aam_call_participants(customer_id)
  where status in ('invited', 'accepted');

-- SECTION 4: supabase/migrations/20261119210000_livekit_one_active_call_per_admin.sql
-- Prevent one administrator session from starting overlapping calls
-- from multiple devices at the same time.

with ranked as (
  select
    id,
    row_number() over (
      partition by admin_session_hash
      order by created_at desc, id desc
    ) as position
  from public.aam_calls
  where caller_role = 'admin'
    and status = 'active'
    and admin_session_hash is not null
)
update public.aam_calls c
set status = 'ended',
    ended_at = coalesce(c.ended_at, now()),
    updated_at = now()
from ranked r
where r.id = c.id
  and r.position > 1;

update public.aam_call_participants p
set status = 'ended'
from public.aam_calls c
where c.id = p.call_id
  and c.caller_role = 'admin'
  and c.status <> 'active'
  and p.status in ('invited', 'accepted');

create unique index if not exists aam_calls_one_active_call_per_admin_idx
  on public.aam_calls(admin_session_hash)
  where caller_role = 'admin'
    and status = 'active'
    and admin_session_hash is not null;

commit;
