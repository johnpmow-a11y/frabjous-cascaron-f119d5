-- Enforce one active call per customer even when two devices tap Call at once.
begin;

-- Repair stale participant rows left by earlier terminal calls.
update public.aam_call_participants p
set status = 'ended'
from public.aam_calls c
where c.id = p.call_id
  and c.status <> 'active'
  and p.status in ('invited', 'accepted');

-- If earlier versions or concurrent requests created overlapping active calls,
-- keep the newest call for each customer and close their older participation.
with ranked as (
  select
    p.call_id,
    p.customer_id,
    row_number() over (
      partition by p.customer_id
      order by c.created_at desc, p.invited_at desc, p.call_id desc
    ) as position
  from public.aam_call_participants p
  join public.aam_calls c on c.id = p.call_id
  where c.status = 'active'
    and p.status in ('invited', 'accepted')
)
update public.aam_call_participants p
set status = 'ended'
from ranked r
where r.position > 1
  and p.call_id = r.call_id
  and p.customer_id = r.customer_id
  and p.status in ('invited', 'accepted');

-- Close customer calls that no longer have both participants, and admin calls
-- whose customer participant was removed during overlap repair.
update public.aam_calls c
set status = 'ended',
    ended_at = coalesce(c.ended_at, now()),
    updated_at = now()
where c.status = 'active'
  and (
    (c.caller_role = 'customer' and (
      select count(*) from public.aam_call_participants p
      where p.call_id = c.id and p.status in ('invited', 'accepted')
    ) < 2)
    or
    (c.caller_role = 'admin' and not exists (
      select 1 from public.aam_call_participants p
      where p.call_id = c.id and p.status in ('invited', 'accepted')
    ))
  );

update public.aam_call_participants p
set status = 'ended'
from public.aam_calls c
where c.id = p.call_id
  and c.status <> 'active'
  and p.status in ('invited', 'accepted');

create unique index if not exists aam_call_participants_one_active_call_per_customer_idx
  on public.aam_call_participants(customer_id)
  where status in ('invited', 'accepted');

commit;
