-- Call records used to authorize LiveKit room tokens and track invitations.
begin;

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

commit;
