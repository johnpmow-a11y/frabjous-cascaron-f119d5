-- All Ads Manager: store the optional personalized text for each gift delivery.
alter table if exists public.ads_delivery_orders
  add column if not exists custom_message text;
