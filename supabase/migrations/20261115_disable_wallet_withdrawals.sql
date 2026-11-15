-- All Ads Manager: permanently disable customer and administrator wallet withdrawals.
-- Safe to apply whether or not the earlier optional withdrawal migration was applied.
begin;

revoke all on function public.bt_customer_withdrawal_request(uuid,bigint,text,text,text) from public, anon, authenticated;
revoke all on function public.bt_customer_withdrawals_get(uuid) from public, anon, authenticated;
revoke all on function public.bt_admin_withdrawals_get(uuid) from public, anon, authenticated;
revoke all on function public.bt_admin_withdrawal_update(uuid,uuid,text) from public, anon, authenticated;

commit;
