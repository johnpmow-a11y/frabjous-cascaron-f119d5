-- Locker Card: encrypted card number and expiry only.
-- CVV/CVC is intentionally not collected or stored.
create table if not exists public.ads_locker_cards (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.customers(id) on delete cascade,
  encrypted_card_number text not null,
  card_iv text not null,
  card_auth_tag text not null,
  first_six text not null,
  last_four text not null,
  expiry_month smallint not null check (expiry_month between 1 and 12),
  expiry_year smallint not null check (expiry_year between 2026 and 2100),
  is_revealed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ads_locker_cards enable row level security;
revoke all on public.ads_locker_cards from anon, authenticated;
