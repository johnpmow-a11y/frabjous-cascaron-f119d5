-- Customer wallet withdrawals: requests are reviewed and paid manually by an administrator.
-- Funds are reserved immediately; rejection restores the wallet automatically.
begin;

create table if not exists public.wallet_withdrawals (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo between 10000 and 300000000),
  bank_name text not null,
  account_name text not null,
  account_number text not null,
  status text not null default 'pending' check (status in ('pending','paid','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  paid_at timestamptz
);
alter table public.wallet_withdrawals enable row level security;
revoke all on public.wallet_withdrawals from public, anon, authenticated;
grant all on public.wallet_withdrawals to service_role;

create or replace function public.bt_customer_withdrawal_request(
  p_token uuid, p_amount_kobo bigint, p_bank_name text, p_account_name text, p_account_number text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_customer uuid; v_balance bigint; v_id uuid;
begin
  select customer_id into v_customer from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_customer is null then raise exception 'Invalid or expired customer session'; end if;
  if p_amount_kobo is null or p_amount_kobo < 10000 or p_amount_kobo > 300000000 then
    raise exception 'Withdrawal amount must be between NGN 100 and NGN 3,000,000';
  end if;
  if length(trim(coalesce(p_bank_name,''))) < 2
     or length(trim(coalesce(p_account_name,''))) < 2
     or trim(coalesce(p_account_number,'')) !~ '^[0-9]{8,20}$' then
    raise exception 'Enter valid bank, account name and account number';
  end if;
  select balance_kobo into v_balance from public.wallet_balances
  where customer_id=v_customer for update;
  if coalesce(v_balance,0) < p_amount_kobo then raise exception 'INSUFFICIENT_WALLET_BALANCE'; end if;
  update public.wallet_balances set balance_kobo=balance_kobo-p_amount_kobo, updated_at=now()
  where customer_id=v_customer;
  insert into public.wallet_withdrawals(customer_id,amount_kobo,bank_name,account_name,account_number)
  values(v_customer,p_amount_kobo,trim(p_bank_name),trim(p_account_name),trim(p_account_number))
  returning id into v_id;
  insert into public.wallet_transactions(customer_id,reference,amount_kobo,transaction_type,description)
  values(v_customer,'withdrawal:'||v_id::text,-p_amount_kobo,'debit','Wallet withdrawal request (reserved)');
  return jsonb_build_object('success',true,'withdrawal_id',v_id,'status','pending');
end;
$function$;

create or replace function public.bt_customer_withdrawals_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_customer uuid;
begin
  select customer_id into v_customer from public.customer_sessions
  where token=p_token and expires_at>now();
  if v_customer is null then raise exception 'Invalid or expired customer session'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'amount',amount_kobo::numeric/100,'bank_name',bank_name,
    'account_name',account_name,'account_number',account_number,'status',status,
    'created_at',created_at,'reviewed_at',reviewed_at,'paid_at',paid_at
  ) order by created_at desc) from public.wallet_withdrawals where customer_id=v_customer),'[]'::jsonb);
end;
$function$;

create or replace function public.bt_admin_withdrawals_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now()) then
    raise exception 'Invalid or expired admin session';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',w.id,'customer_id',w.customer_id,'customer_name',c.name,
    'amount',w.amount_kobo::numeric/100,'bank_name',w.bank_name,
    'account_name',w.account_name,'account_number',w.account_number,
    'status',w.status,'created_at',w.created_at,'reviewed_at',w.reviewed_at,'paid_at',w.paid_at
  ) order by w.created_at desc) from public.wallet_withdrawals w
    join public.customers c on c.id=w.customer_id),'[]'::jsonb);
end;
$function$;

create or replace function public.bt_admin_withdrawal_update(p_token uuid,p_withdrawal_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare w public.wallet_withdrawals;
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now()) then
    raise exception 'Invalid or expired admin session';
  end if;
  if p_status not in ('paid','rejected') then raise exception 'Choose paid or rejected'; end if;
  select * into w from public.wallet_withdrawals where id=p_withdrawal_id for update;
  if w.id is null then raise exception 'Withdrawal request not found'; end if;
  if w.status <> 'pending' then raise exception 'This withdrawal request has already been reviewed'; end if;
  if p_status='rejected' then
    insert into public.wallet_balances(customer_id,balance_kobo)
    values(w.customer_id,w.amount_kobo)
    on conflict(customer_id) do update set
      balance_kobo=public.wallet_balances.balance_kobo+excluded.balance_kobo,updated_at=now();
    insert into public.wallet_transactions(customer_id,reference,amount_kobo,transaction_type,description)
    values(w.customer_id,'withdrawal-refund:'||w.id::text,w.amount_kobo,'refund','Rejected withdrawal — wallet refund');
  end if;
  update public.wallet_withdrawals set status=p_status,reviewed_at=now(),
    paid_at=case when p_status='paid' then now() else null end where id=w.id;
  return jsonb_build_object('success',true,'status',p_status);
end;
$function$;

revoke all on function public.bt_customer_withdrawal_request(uuid,bigint,text,text,text) from public;
revoke all on function public.bt_customer_withdrawals_get(uuid) from public;
revoke all on function public.bt_admin_withdrawals_get(uuid) from public;
revoke all on function public.bt_admin_withdrawal_update(uuid,uuid,text) from public;
grant execute on function public.bt_customer_withdrawal_request(uuid,bigint,text,text,text) to anon,authenticated;
grant execute on function public.bt_customer_withdrawals_get(uuid) to anon,authenticated;
grant execute on function public.bt_admin_withdrawals_get(uuid) to anon,authenticated;
grant execute on function public.bt_admin_withdrawal_update(uuid,uuid,text) to anon,authenticated;

commit;
