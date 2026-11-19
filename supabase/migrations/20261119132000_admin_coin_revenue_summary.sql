-- Exact admin aggregation for paid purchased-coin video views.
begin;
create or replace function public.aam_social_admin_coin_revenue(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_views bigint; v_kobo bigint;
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now()) then
    raise exception 'Administrator login required';
  end if;
  select count(*),coalesce(sum(amount_kobo),0) into v_views,v_kobo
  from public.aam_coin_cash_ledger;
  return jsonb_build_object('paid_video_views',v_views,'paid_video_revenue_ngn',v_kobo::numeric/100);
end;
$$;
revoke all on function public.aam_social_admin_coin_revenue(uuid) from public,anon,authenticated;
grant execute on function public.aam_social_admin_coin_revenue(uuid) to service_role;
commit;
