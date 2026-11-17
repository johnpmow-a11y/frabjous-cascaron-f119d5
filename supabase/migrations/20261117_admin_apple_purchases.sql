begin;

create table if not exists public.admin_purchases (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  item text not null,
  amount_kobo bigint not null check (amount_kobo = 10000),
  currency text not null default 'NGN' check (currency = 'NGN'),
  method text not null check (method in ('bank_transfer','card')),
  status text not null default 'pending' check (status in ('pending','paid','initialization_failed')),
  paystack_transaction_id text,
  paystack_channel text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_purchases_created_at_idx
  on public.admin_purchases (created_at desc);

alter table public.admin_purchases enable row level security;
revoke all on public.admin_purchases from anon, authenticated;
grant all on public.admin_purchases to service_role;

commit;
