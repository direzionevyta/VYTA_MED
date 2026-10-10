-- Run after both accounts have accepted a Supabase Auth invite and after
-- 0001_full_setup.sql and 0002_synthetic_seed.sql have completed.
-- Replace these example email addresses with the two invited demo accounts.
begin;

with demo as (
  select id from public.organizations where slug = 'demo-associazione' and is_demo and active
), demo_crew as (
  select c.id from public.crews c join public.structures s on s.id = c.structure_id
  where s.organization_id = (select id from demo) and c.name = 'Equipaggio Demo 1'
), admin_profile as (
  update public.profiles p
  set full_name = 'Direzione VYTA', role = 'admin', active = true,
      organization_id = (select id from demo), crew_id = null
  where lower(p.email) = lower('admin@example.invalid')
  returning p.id
), operator_profile as (
  update public.profiles p
  set full_name = 'Operatore demo', role = 'operatore', active = true,
      organization_id = (select id from demo), crew_id = (select id from demo_crew)
  where lower(p.email) = lower('operator@example.invalid')
  returning p.id
)
insert into public.user_events (user_id, event_id)
select operator_profile.id, e.id
from operator_profile
cross join public.events e
join public.structures s on s.id = e.structure_id
where s.organization_id = (select id from demo)
  and e.name = 'Evento dimostrativo VYTA MED'
on conflict (user_id, event_id) do nothing;

-- Fail loudly if the invites have not yet created both profiles.
do $$
begin
  if not exists (select 1 from public.profiles where lower(email) = lower('admin@example.invalid') and role = 'admin') then
    raise exception 'Admin invite profile not found; replace admin@example.invalid with the accepted invite email';
  end if;
  if not exists (select 1 from public.profiles where lower(email) = lower('operator@example.invalid') and role = 'operatore') then
    raise exception 'Operator invite profile not found; replace operator@example.invalid with the accepted invite email';
  end if;
end;
$$;

commit;
