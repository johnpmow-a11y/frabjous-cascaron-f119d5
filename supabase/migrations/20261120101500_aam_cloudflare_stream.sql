alter table public.aam_social_posts add column if not exists cloudflare_uid text;
create index if not exists aam_social_posts_cloudflare_uid_idx on public.aam_social_posts(cloudflare_uid) where cloudflare_uid is not null;
