-- Prevent one administrator session from starting overlapping calls
-- from multiple devices at the same time.
begin;

with ranked as (
  select
    id,
    row_number() over (
      partition by admin_session_hash
      order by created_at desc, id desc
    ) as position
  from public.aam_calls
  where caller_role = 'admin'
    and status = 'active'
    and admin_session_hash is not null
)
update public.aam_calls c
set status = 'ended',
    ended_at = coalesce(c.ended_at, now()),
    updated_at = now()
from ranked r
where r.id = c.id
  and r.position > 1;

update public.aam_call_participants p
set status = 'ended'
from public.aam_calls c
where c.id = p.call_id
  and c.caller_role = 'admin'
  and c.status <> 'active'
  and p.status in ('invited', 'accepted');

create unique index if not exists aam_calls_one_active_call_per_admin_idx
  on public.aam_calls(admin_session_hash)
  where caller_role = 'admin'
    and status = 'active'
    and admin_session_hash is not null;

commit;
