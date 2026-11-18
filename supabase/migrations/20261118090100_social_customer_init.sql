-- Automatically provision a social profile and separate zero coin balance for every new account.
begin;
create or replace function public.aam_social_initialize_customer()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.aam_social_profiles(customer_id,display_name)
  values(new.id,new.name)
  on conflict(customer_id) do nothing;
  insert into public.aam_coin_balances(customer_id,balance_coins)
  values(new.id,0)
  on conflict(customer_id) do nothing;
  return new;
end;
$$;
drop trigger if exists aam_social_customer_created on public.customers;
create trigger aam_social_customer_created
after insert on public.customers
for each row execute function public.aam_social_initialize_customer();
revoke all on function public.aam_social_initialize_customer() from public,anon,authenticated;
grant execute on function public.aam_social_initialize_customer() to service_role;
commit;
