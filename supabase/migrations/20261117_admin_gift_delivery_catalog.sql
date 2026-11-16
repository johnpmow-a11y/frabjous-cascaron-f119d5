-- Admin-managed International Gift Delivery catalogue prices.
begin;
create table if not exists public.ads_delivery_gift_catalog (
  catalog_key text primary key,
  item text not null,
  style text not null,
  gender text not null check (gender in ('Woman','Man')),
  image_url text not null,
  price_kobo bigint null check (price_kobo is null or price_kobo between 100 and 300000000),
  updated_at timestamptz not null default now()
);
alter table public.ads_delivery_gift_catalog enable row level security;
revoke all on public.ads_delivery_gift_catalog from public, anon, authenticated;
grant all on public.ads_delivery_gift_catalog to service_role;
commit;
