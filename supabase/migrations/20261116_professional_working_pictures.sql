-- Public catalogue for Professional Working Pictures. Additive only: existing editing/video workflows and prices are untouched.
begin;
create table if not exists public.professional_working_pictures (
 id uuid primary key default gen_random_uuid(), storage_path text not null unique, public_url text not null,
 original_name text not null, price_ngn integer not null default 14100 check(price_ngn=14100),
 status text not null default 'published' check(status in ('published','hidden')), created_at timestamptz not null default now()
);
create index if not exists professional_working_pictures_published_idx on public.professional_working_pictures(created_at desc,id desc) where status='published';
alter table public.professional_working_pictures enable row level security;
revoke all on public.professional_working_pictures from public,anon,authenticated;
grant all on public.professional_working_pictures to service_role;
commit;
