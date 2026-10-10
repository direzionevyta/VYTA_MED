-- Fictitious starting point for the isolated demo tenant. Safe to rerun.
-- Run only after 0001_full_setup.sql and never on production.
begin;

insert into public.organizations (name, slug, active, is_demo)
values ('Organizzazione Demo', 'demo-associazione', true, true)
on conflict (slug) do update set active = true, is_demo = true;

with org as (
  select id from public.organizations where slug = 'demo-associazione'
), structure as (
  insert into public.structures (name, map_image, organization_id)
  select 'Arena Demo', '', org.id from org
  on conflict (organization_id, name) do update set active = true
  returning id, organization_id
)
insert into public.zones (name, kind, map_x, map_y, sort, active, structure_id)
select 'Tribuna Demo', 'settore', 0.42, 0.38, 1, true, structure.id from structure
where not exists (select 1 from public.zones z where z.structure_id = structure.id and z.name = 'Tribuna Demo');

insert into public.event_types (name, color, sort, active, organization_id)
select 'Simulazione sanitaria', '#2468d5', 1, true, id
from public.organizations where slug = 'demo-associazione'
on conflict (organization_id, name) do update set active = true;

insert into public.crew_types (name, active, organization_id)
select 'Equipaggio demo', true, id
from public.organizations where slug = 'demo-associazione'
on conflict (organization_id, name) do update set active = true;

with org as (
  select id from public.organizations where slug = 'demo-associazione'
), structure as (
  select id from public.structures where organization_id = (select id from org) and name = 'Arena Demo'
), crew_type as (
  select id from public.crew_types where organization_id = (select id from org) and name = 'Equipaggio demo'
)
insert into public.crews (name, crew_type_id, members, status, active, structure_id)
select 'Equipaggio Demo 1', crew_type.id, 2, 'disponibile', true, structure.id
from structure cross join crew_type
on conflict (name) do update set active = true, structure_id = excluded.structure_id;

with org as (
  select id from public.organizations where slug = 'demo-associazione'
), structure as (
  select id from public.structures where organization_id = (select id from org) and name = 'Arena Demo'
)
insert into public.events (name, venue, starts_at, status, structure_id)
select 'Evento dimostrativo VYTA MED', 'Arena Demo', now(), 'in_corso', structure.id
from structure
where not exists (
  select 1 from public.events e where e.structure_id = structure.id and e.name = 'Evento dimostrativo VYTA MED'
);

with org as (
  select id from public.organizations where slug = 'demo-associazione'
), event_row as (
  select e.id from public.events e join public.structures s on s.id = e.structure_id
  where s.organization_id = (select id from org) and e.name = 'Evento dimostrativo VYTA MED'
), event_type as (
  select id from public.event_types where organization_id = (select id from org) and name = 'Simulazione sanitaria'
), zone as (
  select z.id from public.zones z join public.structures s on s.id = z.structure_id
  where s.organization_id = (select id from org) and z.name = 'Tribuna Demo'
)
insert into public.interventions (
  event_id, event_type_id, zone_id, first_name, last_name, age, sex,
  triage, status, notes, outcome, destination
)
select event_row.id, event_type.id, zone.id, seed.first_name, seed.last_name, seed.age,
  'Non indicato', seed.triage::public.triage_code, seed.status::public.intervention_status,
  seed.notes, null, null
from event_row cross join event_type cross join zone
cross join (values
  ('Persona', 'Dimostrativa 01', 30, 'verde', 'nuovo', 'Scenario formativo fittizio: lieve malessere.'),
  ('Persona', 'Dimostrativa 02', 45, 'giallo', 'nuovo', 'Scenario formativo fittizio: valutazione sanitaria simulata.')
) as seed(first_name, last_name, age, triage, status, notes)
where not exists (
  select 1 from public.interventions i
  where i.event_id = event_row.id and i.first_name = seed.first_name and i.last_name = seed.last_name
);

insert into public.settings (organization_id, key, value)
select id, 'venue', to_jsonb('Arena Demo'::text)
from public.organizations where slug = 'demo-associazione'
on conflict (organization_id, key) do update set value = excluded.value, updated_at = now();

commit;
