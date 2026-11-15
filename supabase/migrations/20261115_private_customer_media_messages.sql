-- Private administrator messages with optional image/video attachments.
begin;
create table if not exists public.ads_manager_private_media_messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  message text not null default '',
  media_path text,
  created_at timestamptz not null default now(),
  constraint ads_manager_private_media_message_content check (length(message) <= 2000)
);
create index if not exists ads_manager_private_media_messages_customer_created_idx
  on public.ads_manager_private_media_messages(customer_id, created_at desc);
alter table public.ads_manager_private_media_messages enable row level security;
revoke all on public.ads_manager_private_media_messages from public, anon, authenticated;
grant all on public.ads_manager_private_media_messages to service_role;
commit;
