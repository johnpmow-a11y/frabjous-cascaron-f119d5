-- ADS Manager Paystack wallet deposits (NGN).
-- Apply once in the EXISTING project: ftwhcqrtmfxdzokmudvu.
-- Card PAN, CVV, PIN and authentication codes are never stored here.

begin;

create table if not exists public.wallet_deposits (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  customer_id uuid not null references public.customers(id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo between 10000 and 300000000),
  currency text not null default 'NGN' check (currency = 'NGN'),
  method text not null check (method in ('bank_transfer','card')),
  email text not null,
  status text not null default 'pending' check (status in ('pending','success','failed','reversed','initialization_failed')),
  paystack_transaction_id text unique,
  paystack_channel text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_balances (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  balance_kobo bigint not null default 0 check (balance_kobo >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  reference text not null unique,
  amount_kobo bigint not null,
  currency text not null default 'NGN',
  transaction_type text not null check (transaction_type in ('deposit','debit','refund')),
  status text not null default 'success',
  description text not null,
  created_at timestamptz not null default now()
);

-- Keep the correct limits even when this migration is re-run on a table
-- created by the earlier draft. Amounts are stored in kobo.
alter table public.wallet_deposits drop constraint if exists wallet_deposits_amount_kobo_check;
alter table public.wallet_deposits add constraint wallet_deposits_amount_kobo_check
  check (amount_kobo between 10000 and 300000000);

alter table public.wallet_deposits enable row level security;
alter table public.wallet_balances enable row level security;
alter table public.wallet_transactions enable row level security;
revoke all on public.wallet_deposits, public.wallet_balances, public.wallet_transactions from public, anon, authenticated;
grant all on public.wallet_deposits, public.wallet_balances, public.wallet_transactions to service_role;

-- Called only by the trusted Netlify server after Paystack signature and
-- transaction verification. A unique reference makes webhook retries safe.
create or replace function public.bt_paystack_credit_deposit(
  p_reference text,
  p_transaction_id text,
  p_channel text,
  p_paid_at timestamptz,
  p_amount_kobo bigint,
  p_currency text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  d public.wallet_deposits;
begin
  select * into d from public.wallet_deposits where reference = p_reference for update;
  if d.id is null then raise exception 'Deposit reference not found'; end if;
  if d.amount_kobo <> p_amount_kobo or d.currency <> upper(p_currency) then
    raise exception 'Verified payment amount or currency does not match';
  end if;
  if d.status = 'success' then
    return jsonb_build_object('success', true, 'alreadyCredited', true);
  end if;
  if d.status <> 'pending' then raise exception 'Deposit is not pending'; end if;

  update public.wallet_deposits
  set status = 'success', paystack_transaction_id = p_transaction_id,
      paystack_channel = p_channel, paid_at = coalesce(p_paid_at, now())
  where id = d.id;

  insert into public.wallet_balances(customer_id, balance_kobo)
  values (d.customer_id, d.amount_kobo)
  on conflict (customer_id) do update
    set balance_kobo = public.wallet_balances.balance_kobo + excluded.balance_kobo,
        updated_at = now();

  insert into public.wallet_transactions(customer_id, reference, amount_kobo, transaction_type, description)
  values (d.customer_id, d.reference, d.amount_kobo, 'deposit',
          case when d.method = 'card' then 'Paystack card payment' else 'Paystack bank transfer' end);

  return jsonb_build_object('success', true, 'alreadyCredited', false);
end;
$function$;

create or replace function public.bt_customer_wallet_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_customer_id uuid; v_balance bigint;
begin
  select customer_id into v_customer_id from public.customer_sessions
  where token = p_token and expires_at > now();
  if v_customer_id is null then raise exception 'Invalid or expired customer session'; end if;
  select coalesce(balance_kobo,0) into v_balance from public.wallet_balances where customer_id=v_customer_id;
  return jsonb_build_object(
    'balance', coalesce(v_balance,0)::numeric / 100,
    'transactions', coalesce((select jsonb_agg(jsonb_build_object(
      'reference', reference, 'amount', amount_kobo::numeric/100,
      'type', transaction_type, 'status', status, 'description', description,
      'created_at', created_at
    ) order by created_at desc) from public.wallet_transactions where customer_id=v_customer_id), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.bt_admin_wallet_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now())
    then raise exception 'Invalid or expired admin session'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'customer_id', b.customer_id, 'customer_name', c.name,
    'balance', b.balance_kobo::numeric/100, 'updated_at', b.updated_at
  ) order by c.name) from public.wallet_balances b join public.customers c on c.id=b.customer_id), '[]'::jsonb);
end;
$function$;


create or replace function public.bt_admin_wallet_transactions_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now())
    then raise exception 'Invalid or expired admin session'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'customer_name', c.name, 'amount', d.amount_kobo::numeric/100,
    'method', d.method, 'status', d.status, 'reference', d.reference,
    'created_at', d.created_at, 'paid_at', d.paid_at
  ) order by d.created_at desc) from public.wallet_deposits d
    join public.customers c on c.id=d.customer_id), '[]'::jsonb);
end;
$function$;

revoke all on function public.bt_paystack_credit_deposit(text,text,text,timestamptz,bigint,text) from public, anon, authenticated;
grant execute on function public.bt_paystack_credit_deposit(text,text,text,timestamptz,bigint,text) to service_role;
revoke all on function public.bt_customer_wallet_get(uuid) from public, anon, authenticated;
grant execute on function public.bt_customer_wallet_get(uuid) to anon, authenticated;
revoke all on function public.bt_admin_wallet_get(uuid) from public, anon, authenticated;
grant execute on function public.bt_admin_wallet_get(uuid) to anon, authenticated;

revoke all on function public.bt_admin_wallet_transactions_get(uuid) from public, anon, authenticated;
grant execute on function public.bt_admin_wallet_transactions_get(uuid) to anon, authenticated;

commit;
