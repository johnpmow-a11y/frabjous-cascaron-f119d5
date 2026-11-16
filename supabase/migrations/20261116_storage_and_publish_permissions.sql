-- All Ads Manager storage buckets and server-side publishing RPC permissions.
-- Additive and safe to re-run. Does not alter customer data or existing payment settings.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('professional-working-pictures','professional-working-pictures',true,20971520,array['image/jpeg','image/png','image/webp','image/avif','image/gif']::text[]),
  ('ads-manager-private','ads-manager-private',false,524288000,array['video/mp4','video/quicktime','video/webm','image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update
set name=excluded.name, public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

-- Netlify support endpoints use service_role to call these RPC functions.
-- Restore EXECUTE permission for all overloads that exist in public schema.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('b_admin_publish_note','bt_admin_publish_note','b_admin_update_record','bt_admin_update_record')
  loop
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end
$$;

commit;
