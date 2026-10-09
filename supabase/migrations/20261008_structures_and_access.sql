-- Make venues first-class records, and scope every space and event to one.
create table if not exists public.structures (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  map_image text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.structures to authenticated;

alter table public.zones add column if not exists structure_id uuid references public.structures(id);
alter table public.events add column if not exists structure_id uuid references public.structures(id);
alter table public.crews add column if not exists structure_id uuid references public.structures(id);

-- Preserve the existing single-venue setup by moving it into a first structure.
insert into public.structures (name, map_image)
select
  coalesce((select value #>> '{}' from public.settings where key = 'venue'), 'Struttura principale'),
  coalesce((select value #>> '{}' from public.settings where key = 'map_image'), '')
where not exists (select 1 from public.structures);

update public.zones
set structure_id = (select id from public.structures order by created_at, id limit 1)
where structure_id is null;

update public.crews
set structure_id = (select id from public.structures order by created_at, id limit 1)
where structure_id is null;

update public.events e
set structure_id = coalesce(
  (select s.id from public.structures s where s.name = e.venue limit 1),
  (select s.id from public.structures s order by s.created_at, s.id limit 1)
)
where e.structure_id is null;

-- If old event venues already match a saved structure name, prefer that exact
-- match over the default structure chosen by the legacy backfill above.
with candidates as (
  select e.id as event_id, s.id as structure_id, s.name as structure_name,
    count(*) over (partition by e.id) as match_count
  from public.events e
  join public.structures s on
    lower(btrim(e.venue)) = lower(btrim(s.name))
    or (length(btrim(e.venue)) >= 5 and lower(s.name) like '%' || lower(btrim(e.venue)) || '%')
), unique_matches as (
  select event_id, structure_id, structure_name
  from candidates where match_count = 1
)
update public.events e
set structure_id = u.structure_id, venue = u.structure_name
from unique_matches u
where e.id = u.event_id
  and e.structure_id is distinct from u.structure_id;

create index if not exists zones_structure_sort_idx on public.zones (structure_id, sort);
create index if not exists events_structure_status_idx on public.events (structure_id, status);
create index if not exists crews_structure_idx on public.crews (structure_id);

-- Centralize role checks so the policies do not recurse through profile RLS.
create or replace function public.current_user_is_active_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin') $$;

create or replace function public.current_user_crew_id()
returns uuid language sql stable security definer set search_path = public
as $$ select crew_id from public.profiles where id = auth.uid() and active limit 1 $$;

create or replace function public.current_user_structure_id()
returns uuid language sql stable security definer set search_path = public
as $$
  select c.structure_id
  from public.profiles p join public.crews c on c.id = p.crew_id
  where p.id = auth.uid() and p.active
  limit 1
$$;

-- Replace existing policies on these tables so permissive legacy policies
-- cannot accidentally expose every row through an OR condition.
do $$
declare t text; p record;
begin
  foreach t in array array['interventions', 'events', 'structures', 'zones', 'crews'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

alter table public.interventions enable row level security;
alter table public.events enable row level security;
alter table public.structures enable row level security;
alter table public.zones enable row level security;
alter table public.crews enable row level security;

create policy interventions_read_admin_or_crew on public.interventions
for select to authenticated using (
  public.current_user_is_active_admin()
  or (public.current_user_crew_id() is not null and (
    crew_id = public.current_user_crew_id()
    or public.current_user_crew_id() = any(coalesce(crew_ids, '{}'::uuid[]))
  ))
);
create policy interventions_insert_admin_or_own on public.interventions
for insert to authenticated with check (
  public.current_user_is_active_admin()
  or (created_by = auth.uid() and public.current_user_crew_id() is not null and (
    crew_id = public.current_user_crew_id()
    or public.current_user_crew_id() = any(coalesce(crew_ids, '{}'::uuid[]))
  ))
);
create policy interventions_update_admin_or_own on public.interventions
for update to authenticated using (
  public.current_user_is_active_admin()
  or (public.current_user_crew_id() is not null and (
    crew_id = public.current_user_crew_id()
    or public.current_user_crew_id() = any(coalesce(crew_ids, '{}'::uuid[]))
  ))
) with check (auth.uid() is not null);
create policy interventions_delete_admin on public.interventions
for delete to authenticated using (public.current_user_is_active_admin());

create policy events_read_admin_or_assigned on public.events
for select to authenticated using (
  public.current_user_is_active_admin()
  or (structure_id = public.current_user_structure_id())
);
create policy events_admin_manage on public.events
for all to authenticated using (public.current_user_is_active_admin())
with check (public.current_user_is_active_admin());

create policy structures_read_admin_or_assigned on public.structures
for select to authenticated using (
  public.current_user_is_active_admin()
  or exists (select 1 from public.events e where e.structure_id = structures.id)
);
create policy structures_admin_manage on public.structures
for all to authenticated using (public.current_user_is_active_admin())
with check (public.current_user_is_active_admin());

create policy zones_read_admin_or_assigned on public.zones
for select to authenticated using (
  public.current_user_is_active_admin()
  or exists (select 1 from public.events e where e.structure_id = zones.structure_id)
);
create policy zones_admin_manage on public.zones
for all to authenticated using (public.current_user_is_active_admin())
with check (public.current_user_is_active_admin());

create policy crews_read_admin_or_related on public.crews
for select to authenticated using (
  public.current_user_is_active_admin()
  or id = public.current_user_crew_id()
  or exists (
    select 1 from public.interventions i
    where i.crew_id = crews.id or crews.id = any(coalesce(i.crew_ids, '{}'::uuid[]))
  )
);
create policy crews_admin_manage on public.crews
for all to authenticated using (public.current_user_is_active_admin())
with check (public.current_user_is_active_admin());
create policy crews_own_status_update on public.crews
for update to authenticated using (id = public.current_user_crew_id())
with check (id = public.current_user_crew_id());
