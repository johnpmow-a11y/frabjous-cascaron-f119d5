create table if not exists public.ads_manager_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('admin','customer')),
  customer_id text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ads_manager_push_role_customer_check check (
    (role = 'admin' and customer_id is null) or
    (role = 'customer' and customer_id is not null)
  )
);
create index if not exists ads_manager_push_role_customer_idx
  on public.ads_manager_push_subscriptions(role, customer_id);
alter table public.ads_manager_push_subscriptions enable row level security;
revoke all on public.ads_manager_push_subscriptions from anon, authenticated;
