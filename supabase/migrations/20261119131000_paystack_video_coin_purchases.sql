-- Verified Paystack purchase ledger for cash-backed video coins.
begin;
create table if not exists public.aam_coin_purchase_payments(
  reference text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  amount_kobo bigint not null check(amount_kobo between 50000 and 300000000),
  coins bigint not null check(coins=amount_kobo/100),
  status text not null default 'pending' check(status in ('pending','success','failed')),
  paystack_transaction_id text unique,
  currency text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists aam_coin_purchase_customer_idx on public.aam_coin_purchase_payments(customer_id,created_at desc);
alter table public.aam_coin_purchase_payments enable row level security;
revoke all on public.aam_coin_purchase_payments from public,anon,authenticated;
grant all on public.aam_coin_purchase_payments to service_role;

create or replace function public.aam_social_credit_coin_purchase(
  p_reference text,p_transaction_id text,p_amount_kobo bigint,p_currency text,p_paid_at timestamptz
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_payment public.aam_coin_purchase_payments; v_inserted integer;
begin
  select * into v_payment from public.aam_coin_purchase_payments
  where reference=p_reference for update;
  if v_payment.reference is null then raise exception 'Coin purchase record not found'; end if;
  if v_payment.status='success' then
    return jsonb_build_object('credited',false,'already_credited',true,'coins',v_payment.coins);
  end if;
  if p_currency<>'NGN' or p_amount_kobo<>v_payment.amount_kobo or v_payment.coins<>p_amount_kobo/100 then
    raise exception 'Verified payment amount does not match this coin purchase';
  end if;
  update public.aam_coin_purchase_payments
  set status='success',paystack_transaction_id=p_transaction_id,currency=p_currency,paid_at=coalesce(p_paid_at,now())
  where reference=p_reference and status='pending';
  get diagnostics v_inserted = row_count;
  if v_inserted<>1 then raise exception 'Coin purchase has already been processed'; end if;
  update public.aam_coin_balances
  set purchased_coins=purchased_coins+v_payment.coins
  where customer_id=v_payment.customer_id;
  if not found then
    insert into public.aam_coin_balances(customer_id,free_coins,purchased_coins)
    values(v_payment.customer_id,0,v_payment.coins);
  end if;
  insert into public.aam_coin_transactions(customer_id,reference,transaction_type,amount_coins,description)
  values(v_payment.customer_id,'purchase:'||p_reference,'coin_purchase',v_payment.coins,
    'Verified Paystack purchase of '||v_payment.coins||' video coins');
  return jsonb_build_object('credited',true,'already_credited',false,'coins',v_payment.coins);
end;
$$;
revoke all on function public.aam_social_credit_coin_purchase(text,text,bigint,text,timestamptz) from public,anon,authenticated;
grant execute on function public.aam_social_credit_coin_purchase(text,text,bigint,text,timestamptz) to service_role;
commit;
