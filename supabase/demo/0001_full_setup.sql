-- Generated fresh-project setup: baseline followed by repository migrations in filename order.
-- ==== supabase/demo/0000_baseline.sql ====
-- Fresh, data-free baseline for the isolated VYTA MED demo project.
-- Apply this only to the VYTA MED Demo Supabase project, before the checked-in
-- migrations. It intentionally creates no real user or intervention records.

create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('admin', 'co', 'operatore', 'medico');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.crew_status as enum ('disponibile', 'impegnato', 'non_disponibile');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.event_status as enum ('preparazione', 'in_corso', 'concluso');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.intervention_status as enum ('nuovo', 'assegnato', 'in_viaggio', 'sul_posto', 'in_trattamento', 'in_trasporto', 'concluso', 'annullato');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.triage_code as enum ('bianco', 'verde', 'giallo', 'rosso');
exception when duplicate_object then null; end $$;

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

-- Create the structure relationship in the baseline because an early
-- historical migration defines a function that reads crews.structure_id.
-- The later structures migration fills and scopes these columns as usual.
create table if not exists public.structures (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  map_image text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.crew_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean default true
);

create table if not exists public.event_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text default '#64748b',
  sort integer default 0,
  active boolean default true
);

create table if not exists public.zones (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid references public.structures(id),
  name text not null,
  parent_id uuid references public.zones(id) on delete set null,
  kind text default 'spazio',
  map_x numeric,
  map_y numeric,
  sort integer default 0,
  active boolean default true
);

create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid references public.structures(id),
  name text not null unique,
  crew_type_id uuid references public.crew_types(id),
  members integer default 2,
  status public.crew_status not null default 'disponibile',
  base_zone_id uuid references public.zones(id) on delete set null,
  active boolean default true
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid references public.structures(id),
  name text not null,
  venue text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.event_status not null default 'preparazione',
  intervention_counter integer not null default 0,
  created_at timestamptz default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.user_role not null default 'operatore',
  crew_id uuid references public.crews(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz default now(),
  email text
);

create table if not exists public.interventions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid default gen_random_uuid() unique,
  event_id uuid not null references public.events(id),
  number integer,
  event_type_id uuid references public.event_types(id),
  zone_id uuid references public.zones(id),
  location_note text,
  first_name text,
  last_name text,
  age integer,
  sex text,
  triage public.triage_code,
  triage_by uuid references public.profiles(id),
  status public.intervention_status not null default 'nuovo',
  crew_id uuid references public.crews(id),
  notes text,
  outcome text,
  destination text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  closed_at timestamptz,
  crew_ids uuid[] not null default '{}'::uuid[]
);

create sequence if not exists public.intervention_log_id_seq;
create table if not exists public.intervention_log (
  id bigint primary key default nextval('public.intervention_log_id_seq'::regclass),
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  at timestamptz default now(),
  by_user uuid,
  action text not null,
  detail jsonb
);

create index if not exists interventions_event_created_idx on public.interventions (event_id, created_at desc);
create index if not exists crews_status_active_idx on public.crews (status, active);

alter table public.settings enable row level security;
alter table public.crew_types enable row level security;
alter table public.event_types enable row level security;
alter table public.zones enable row level security;
alter table public.crews enable row level security;
alter table public.events enable row level security;
alter table public.profiles enable row level security;
alter table public.interventions enable row level security;
alter table public.intervention_log enable row level security;

grant select, insert, update, delete on public.settings, public.crew_types, public.event_types,
  public.zones, public.crews, public.events, public.interventions to authenticated;
grant select, insert, update, delete on public.structures to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.intervention_log to authenticated;
grant usage, select on sequence public.intervention_log_id_seq to authenticated;

-- A new invite gets a least-privilege profile in the demo tenant; the profile
-- trigger does not use user-editable metadata to choose a privileged role.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, auth
as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'operatore', new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Compatibility stubs exist only so the historical privilege migration can
-- explicitly revoke legacy helper entry points. No public API invokes these.
create or replace function public.app_crew() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function public.app_role() returns text language sql stable as $$ select null::text $$;
create or replace function public.current_user_is_active_admin() returns boolean language sql stable as $$ select false $$;
create or replace function public.guard_intervention() returns trigger language plpgsql as $$ begin return new; end $$;
create or replace function public.log_intervention() returns trigger language plpgsql as $$ begin return new; end $$;
create or replace function public.set_intervention_number()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.number is null
    and not exists (
      select 1 from public.interventions i
      where i.id = new.id or (new.client_id is not null and i.client_id = new.client_id)
    ) then
    update public.events
      set intervention_counter = intervention_counter + 1
      where id = new.event_id
      returning intervention_counter into new.number;
    if new.number is null then
      raise exception 'Event not found while assigning intervention number';
    end if;
  elsif tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status in ('concluso', 'annullato') and old.status is distinct from new.status then
      new.closed_at := now();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists interventions_number_and_timestamp on public.interventions;
create trigger interventions_number_and_timestamp before insert or update on public.interventions
for each row execute function public.set_intervention_number();

-- ==== supabase/migrations/20261008_multi_crew.sql ====
-- Support multiple responding crews on one intervention.
-- The primary crew_id column remains the lead crew for older clients/reports.
alter table public.interventions
  add column if not exists crew_ids uuid[] not null default '{}'::uuid[];

-- Backfill existing lead crews so old interventions display consistently.
update public.interventions
set crew_ids = array[crew_id]
where crew_id is not null and cardinality(crew_ids) = 0;

-- ==== supabase/migrations/20261008_multiple_active_events.sql ====
-- The application supports selecting among multiple events in corso.
-- Remove a unique constraint on events.status, if one was created, and any
-- partial unique index that only allowed one row with status = 'in_corso'.
do $$
declare
  c record;
  i record;
  status_attnum smallint;
begin
  select attnum into status_attnum
  from pg_attribute
  where attrelid = 'public.events'::regclass and attname = 'status' and not attisdropped;

  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.events'::regclass
      and contype = 'u'
      and conkey = array[status_attnum]::smallint[]
  loop
    execute format('alter table public.events drop constraint %I', c.conname);
  end loop;

  for i in
    select idx.indexrelid::regclass as index_name
    from pg_index idx
    where idx.indrelid = 'public.events'::regclass
      and idx.indisunique
      and idx.indpred is not null
      and pg_get_expr(idx.indpred, idx.indrelid) ilike '%status%'
      and pg_get_expr(idx.indpred, idx.indrelid) ilike '%in_corso%'
  loop
    execute format('drop index if exists %s', i.index_name);
  end loop;
end $$;

-- ==== supabase/migrations/20261008_operator_event_selection.sql ====
-- Let each non-admin account select active events associated with its crew's
-- structure. Intervention rows remain limited to the signed-in user's crew.
create or replace function public.current_user_structure_id()
returns uuid language sql stable security definer set search_path = public
as $$
  select c.structure_id
  from public.profiles p join public.crews c on c.id = p.crew_id
  where p.id = auth.uid() and p.active
  limit 1
$$;

drop policy if exists events_read_admin_or_assigned on public.events;
create policy events_read_admin_or_assigned on public.events
for select to authenticated using (
  public.current_user_is_active_admin()
  or structure_id = public.current_user_structure_id()
);

-- ==== supabase/migrations/20261008_profile_email_for_password_reset.sql ====
-- Keep account email in the admin-visible profile so admins can send recovery links.
alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is distinct from u.email;

create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ==== supabase/migrations/20261008_relink_events_to_structures.sql ====
-- Correct legacy event links when the venue exactly matches a saved structure,
-- or when the venue is an unambiguous part of that structure's name.
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

-- ==== supabase/migrations/20261008_structures_and_access.sql ====
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

-- ==== supabase/migrations/20261008_user_event_access.sql ====
-- Per-user event access, independent from the user's role and crew assignment.
create table if not exists public.user_events (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.user_events enable row level security;
grant select, insert, delete on public.user_events to authenticated;

drop policy if exists user_events_read_self_or_admin on public.user_events;
create policy user_events_read_self_or_admin on public.user_events
for select to authenticated using (
  user_id = auth.uid() or public.current_user_is_active_admin()
);
drop policy if exists user_events_admin_manage on public.user_events;
create policy user_events_admin_manage on public.user_events
for all to authenticated using (public.current_user_is_active_admin())
with check (public.current_user_is_active_admin());

-- Keep current users' event access after migration by translating their crew's
-- structure access into explicit assignments. Admins remain unrestricted.
insert into public.user_events (user_id, event_id)
select p.id, e.id
from public.profiles p
join public.crews c on c.id = p.crew_id
join public.events e on e.structure_id = c.structure_id
where p.active and p.role <> 'admin'
on conflict (user_id, event_id) do nothing;

drop policy if exists events_read_admin_or_assigned on public.events;
create policy events_read_admin_or_assigned on public.events
for select to authenticated using (
  public.current_user_is_active_admin()
  or exists (
    select 1 from public.user_events ue
    where ue.user_id = auth.uid() and ue.event_id = events.id
  )
);

-- ==== supabase/migrations/20261008_z_event_activity_log.sql ====
-- Operational event diary. Patient-identifying details and free-text notes are
-- deliberately excluded; only dispatch/status/location metadata is recorded.
create table if not exists public.event_activity (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  intervention_id uuid references public.interventions(id) on delete set null,
  actor_id uuid,
  actor_label text not null default 'Sistema',
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists event_activity_event_created_idx
  on public.event_activity (event_id, created_at desc);
alter table public.event_activity enable row level security;
grant select on public.event_activity to authenticated;
drop policy if exists event_activity_read_assigned_event on public.event_activity;
create policy event_activity_read_assigned_event on public.event_activity
for select to authenticated using (
  exists (select 1 from public.events e where e.id = event_activity.event_id)
  and (
    event_activity.intervention_id is null
    or exists (select 1 from public.interventions i where i.id = event_activity.intervention_id)
  )
);

-- Event-assigned dispatch roles can see the full crew roster for the venue.
drop policy if exists crews_read_assigned_event_structure on public.crews;
create policy crews_read_assigned_event_structure on public.crews
for select to authenticated using (
  exists (
    select 1 from public.user_events ue
    join public.events e on e.id = ue.event_id
    where ue.user_id = auth.uid() and e.structure_id = crews.structure_id
  )
);

create or replace function public.record_event_activity()
returns trigger language plpgsql security definer set search_path = public, auth
as $$
declare
  who text;
  old_crews jsonb;
  new_crews jsonb;
begin
  select coalesce(nullif(p.full_name, ''), 'Utente') into who
  from public.profiles p where p.id = auth.uid();
  who := coalesce(who, 'Sistema');

  if tg_table_name = 'events' then
    if tg_op = 'INSERT' then
      insert into public.event_activity(event_id, actor_id, actor_label, action, details)
      values (new.id, auth.uid(), who, 'evento_aperto', jsonb_build_object('nome', new.name));
    elsif old.status is distinct from new.status then
      insert into public.event_activity(event_id, actor_id, actor_label, action, details)
      values (new.id, auth.uid(), who, 'stato_evento', jsonb_build_object('da', old.status, 'a', new.status));
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.event_activity(event_id, intervention_id, actor_id, actor_label, action, details)
    values (new.event_id, new.id, auth.uid(), who, 'intervento_aperto',
      jsonb_build_object('numero', new.number, 'stato', new.status, 'triage', new.triage, 'zona_id', new.zone_id));
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.event_activity(event_id, intervention_id, actor_id, actor_label, action, details)
    values (new.event_id, new.id, auth.uid(), who, 'stato_intervento', jsonb_build_object('da', old.status, 'a', new.status));
  end if;
  if old.crew_id is distinct from new.crew_id or old.crew_ids is distinct from new.crew_ids then
    old_crews := to_jsonb(coalesce(old.crew_ids, array[old.crew_id]));
    new_crews := to_jsonb(coalesce(new.crew_ids, array[new.crew_id]));
    insert into public.event_activity(event_id, intervention_id, actor_id, actor_label, action, details)
    values (new.event_id, new.id, auth.uid(), who, 'equipaggi_aggiornati', jsonb_build_object('da', old_crews, 'a', new_crews));
  end if;
  if old.zone_id is distinct from new.zone_id then
    insert into public.event_activity(event_id, intervention_id, actor_id, actor_label, action, details)
    values (new.event_id, new.id, auth.uid(), who, 'zona_aggiornata', jsonb_build_object('da', old.zone_id, 'a', new.zone_id));
  end if;
  if old.triage is distinct from new.triage then
    insert into public.event_activity(event_id, intervention_id, actor_id, actor_label, action, details)
    values (new.event_id, new.id, auth.uid(), who, 'triage_aggiornato', jsonb_build_object('da', old.triage, 'a', new.triage));
  end if;
  if old.notes is distinct from new.notes
    and left(coalesce(new.notes, ''), length(coalesce(old.notes, ''))) = coalesce(old.notes, '')
    and position('[Consegna ' in substring(coalesce(new.notes, '') from length(coalesce(old.notes, '')) + 1)) > 0 then
    insert into public.event_activity(event_id, intervention_id, actor_id, actor_label, action, details)
    values (new.event_id, new.id, auth.uid(), who, 'passaggio_consegne', jsonb_build_object('da', old_crews, 'a', new_crews));
  end if;
  return new;
end;
$$;

drop trigger if exists events_activity_trigger on public.events;
create trigger events_activity_trigger after insert or update of status on public.events
for each row execute function public.record_event_activity();
drop trigger if exists interventions_activity_trigger on public.interventions;
create trigger interventions_activity_trigger after insert or update of status, crew_id, crew_ids, zone_id, triage, notes on public.interventions
for each row execute function public.record_event_activity();

-- ==== supabase/migrations/20261008_zz_event_posts.sql ====
-- Crew deployment is stored per event, independently of each crew's base zone.
create table if not exists public.event_posts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  zone_id uuid not null references public.zones(id),
  crew_id uuid references public.crews(id),
  post_number integer not null check (post_number > 0),
  created_at timestamptz not null default now(),
  unique (event_id, zone_id),
  unique (event_id, post_number),
  unique (event_id, crew_id)
);

create index if not exists event_posts_event_idx on public.event_posts (event_id, post_number);
alter table public.event_posts enable row level security;
grant select, insert, update, delete on public.event_posts to authenticated;

-- Assigned event coordinators need the full crew roster to prepare the board.
drop policy if exists crews_read_assigned_event_structure on public.crews;
create policy crews_read_assigned_event_structure on public.crews
for select to authenticated using (
  exists (
    select 1 from public.user_events ue
    join public.events e on e.id = ue.event_id
    where ue.user_id = auth.uid() and e.structure_id = crews.structure_id
  )
);

drop policy if exists event_posts_read_assigned_event on public.event_posts;
create policy event_posts_read_assigned_event on public.event_posts
for select to authenticated using (
  exists (select 1 from public.events e where e.id = event_posts.event_id)
);

drop policy if exists event_posts_co_manage_assigned_event on public.event_posts;
create policy event_posts_co_manage_assigned_event on public.event_posts
for all to authenticated using (
  public.current_user_is_active_admin()
  or exists (
    select 1 from public.profiles p
    join public.user_events ue on ue.user_id = p.id
    where p.id = auth.uid() and p.active and p.role = 'co' and ue.event_id = event_posts.event_id
  )
) with check (
  public.current_user_is_active_admin()
  or (
    exists (
      select 1 from public.profiles p
      join public.user_events ue on ue.user_id = p.id
      where p.id = auth.uid() and p.active and p.role = 'co' and ue.event_id = event_posts.event_id
    )
    and exists (
      select 1 from public.events e join public.zones z on z.id = event_posts.zone_id
      where e.id = event_posts.event_id and z.structure_id = e.structure_id
    )
    and (
      event_posts.crew_id is null
      or exists (
        select 1 from public.events e join public.crews c on c.id = event_posts.crew_id
        where e.id = event_posts.event_id and c.structure_id = e.structure_id
      )
    )
  )
);

-- ==== supabase/migrations/20261009_security_hardening.sql ====
-- Restrict intervention access to events visible to the signed-in user and
-- keep row access within the user's current crew after updates.
create or replace function public.current_user_is_active_co()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'co'
  )
$$;

revoke all on function public.current_user_is_active_co() from public;
grant execute on function public.current_user_is_active_co() to authenticated;

create or replace function public.current_user_can_access_event(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events e
    where e.id = target_event_id
      and (
        public.current_user_is_active_admin()
        or (
          not public.current_user_is_active_co()
          and e.structure_id = public.current_user_structure_id()
        )
        or exists (
          select 1
          from public.user_events ue
          join public.profiles p on p.id = ue.user_id
          where ue.user_id = auth.uid() and ue.event_id = e.id and p.active
        )
      )
  )
$$;

revoke all on function public.current_user_can_access_event(uuid) from public;
grant execute on function public.current_user_can_access_event(uuid) to authenticated;

drop policy if exists events_read_admin_or_assigned on public.events;
create policy events_read_admin_or_assigned on public.events
for select to authenticated using (
  public.current_user_is_active_admin()
  or exists (
    select 1 from public.user_events ue
    join public.profiles p on p.id = ue.user_id
    where ue.user_id = auth.uid() and ue.event_id = events.id and p.active
  )
  or (
    not public.current_user_is_active_co()
    and structure_id = public.current_user_structure_id()
  )
);

drop policy if exists crews_co_status_update on public.crews;
create policy crews_co_status_update on public.crews
for update to authenticated using (
  public.current_user_is_active_co()
  and exists (
    select 1 from public.user_events ue
    join public.events e on e.id = ue.event_id
    join public.profiles p on p.id = ue.user_id
    where ue.user_id = auth.uid() and p.active and p.role = 'co'
      and e.structure_id = crews.structure_id
  )
) with check (
  public.current_user_is_active_co()
  and exists (
    select 1 from public.user_events ue
    join public.events e on e.id = ue.event_id
    join public.profiles p on p.id = ue.user_id
    where ue.user_id = auth.uid() and p.active and p.role = 'co'
      and e.structure_id = crews.structure_id
  )
);

drop policy if exists interventions_read_admin_or_crew on public.interventions;
create policy interventions_read_admin_or_crew on public.interventions
for select to authenticated using (
  public.current_user_is_active_admin()
  or (
    public.current_user_can_access_event(event_id)
    and (
      public.current_user_is_active_co()
      or (
        public.current_user_crew_id() is not null
        and (
          crew_id = public.current_user_crew_id()
          or public.current_user_crew_id() = any(coalesce(crew_ids, '{}'::uuid[]))
        )
      )
    )
  )
);

drop policy if exists interventions_insert_admin_or_own on public.interventions;
create policy interventions_insert_admin_or_own on public.interventions
for insert to authenticated with check (
  public.current_user_is_active_admin()
  or (
    created_by = auth.uid()
    and public.current_user_can_access_event(event_id)
    and (
      (
        public.current_user_is_active_co()
        and crew_id is null
        and cardinality(coalesce(crew_ids, '{}'::uuid[])) = 0
      )
      or (
        public.current_user_crew_id() is not null
        and (
          crew_id = public.current_user_crew_id()
          or public.current_user_crew_id() = any(coalesce(crew_ids, '{}'::uuid[]))
        )
      )
    )
  )
);

drop policy if exists interventions_update_admin_or_own on public.interventions;
create policy interventions_update_admin_or_own on public.interventions
for update to authenticated using (
  public.current_user_is_active_admin()
  or (
    public.current_user_can_access_event(event_id)
    and (
      public.current_user_is_active_co()
      or (
        public.current_user_crew_id() is not null
        and (
          crew_id = public.current_user_crew_id()
          or public.current_user_crew_id() = any(coalesce(crew_ids, '{}'::uuid[]))
        )
      )
    )
  )
) with check (
  public.current_user_is_active_admin()
  or (
    public.current_user_can_access_event(event_id)
    and exists (
      select 1
      from public.events e
      where e.id = event_id
        and (
          crew_id is null
          or exists (
            select 1 from public.crews c
            where c.id = crew_id and c.structure_id = e.structure_id
          )
        )
        and not exists (
          select 1
          from unnest(coalesce(crew_ids, '{}'::uuid[])) as assigned(crew_id)
          where not exists (
            select 1 from public.crews c
            where c.id = assigned.crew_id and c.structure_id = e.structure_id
          )
        )
    )
  )
);

-- Keep intervention identity stable and crew assignment admin-only, matching
-- the permissions exposed by the application.
create or replace function public.prevent_intervention_identity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
begin
  if not public.current_user_is_active_admin() then
    select p.role into actor_role
    from public.profiles p
    where p.id = auth.uid() and p.active;

    if new.id is distinct from old.id
      or new.event_id is distinct from old.event_id
      or new.created_by is distinct from old.created_by then
      raise exception 'Intervention identity fields cannot be changed';
    end if;

    if new.triage is distinct from old.triage
      and coalesce(actor_role, '') not in ('co', 'medico') then
      raise exception 'This role cannot change triage';
    end if;

    if new.crew_id is distinct from old.crew_id
      or new.crew_ids is distinct from old.crew_ids then
      raise exception 'Only admins can reassign intervention crews';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists intervention_identity_guard on public.interventions;
create trigger intervention_identity_guard
before update on public.interventions
for each row execute function public.prevent_intervention_identity_change();

create or replace function public.prevent_non_status_crew_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_active_admin()
    and (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'This role can only change crew status';
  end if;
  return new;
end;
$$;

drop trigger if exists crew_status_guard on public.crews;
create trigger crew_status_guard
before update on public.crews
for each row execute function public.prevent_non_status_crew_changes();

-- ==== supabase/migrations/20261010_organizations.sql ====
-- First multi-organization foundation. Existing data and users are retained in
-- a single legacy tenant; tenant ownership follows structures/events.
create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists organization_id uuid references public.organizations(id);
alter table public.profiles add column if not exists is_platform_admin boolean not null default false;
alter table public.structures add column if not exists organization_id uuid references public.organizations(id);
alter table public.event_types add column if not exists organization_id uuid references public.organizations(id);
alter table public.crew_types add column if not exists organization_id uuid references public.organizations(id);
alter table public.settings add column if not exists organization_id uuid references public.organizations(id);

insert into public.organizations (name, slug)
values ('Organizzazione principale', 'principale')
on conflict (slug) do nothing;

update public.profiles
set organization_id = (select id from public.organizations where slug = 'principale')
where organization_id is null;

update public.structures
set organization_id = (select id from public.organizations where slug = 'principale')
where organization_id is null;

update public.event_types
set organization_id = (select id from public.organizations where slug = 'principale')
where organization_id is null;

update public.crew_types
set organization_id = (select id from public.organizations where slug = 'principale')
where organization_id is null;

update public.settings
set organization_id = (select id from public.organizations where slug = 'principale')
where organization_id is null;

-- Settings are keyed per tenant. The existing installation uses key as its
-- primary key, so replace it with a tenant-aware composite key.
do $$
declare old_pk text;
begin
  select conname into old_pk from pg_constraint
  where conrelid = 'public.settings'::regclass and contype = 'p';
  if old_pk is not null then
    execute format('alter table public.settings drop constraint %I', old_pk);
  end if;
end $$;
alter table public.settings alter column organization_id set not null;
alter table public.settings add constraint settings_organization_key_pkey primary key (organization_id, key);

-- Names may repeat across customer accounts; they remain unique within each one.
do $$
declare item record;
begin
  for item in
    select c.conname, t.relname as table_name
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = c.conkey[1]
    where n.nspname = 'public' and c.contype = 'u'
      and cardinality(c.conkey) = 1 and a.attname = 'name'
      and t.relname in ('structures', 'event_types', 'crew_types')
  loop
    execute format('alter table public.%I drop constraint %I', item.table_name, item.conname);
  end loop;
end $$;
create unique index if not exists structures_organization_name_uidx on public.structures (organization_id, name);
create unique index if not exists event_types_organization_name_uidx on public.event_types (organization_id, name);
create unique index if not exists crew_types_organization_name_uidx on public.crew_types (organization_id, name);

-- Only the account owner receives platform-wide access. Customer admins remain
-- limited to their own organization.
update public.profiles
set is_platform_admin = true
where lower(email) = lower('platform-admin-bootstrap-disabled@example.invalid') and active and role = 'admin';

create index if not exists profiles_organization_idx on public.profiles (organization_id);
create index if not exists structures_organization_idx on public.structures (organization_id);
create index if not exists event_types_organization_idx on public.event_types (organization_id);
create index if not exists crew_types_organization_idx on public.crew_types (organization_id);
create index if not exists settings_organization_idx on public.settings (organization_id);

create or replace function public.current_user_organization_id()
returns uuid language sql stable security definer set search_path = public
as $$
  select p.organization_id
  from public.profiles p join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid() and p.active and o.active
  limit 1
$$;

create or replace function public.current_user_is_platform_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and active and is_platform_admin) $$;

create or replace function public.current_user_is_active_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.active and p.role = 'admin'
    and (p.is_platform_admin or p.organization_id = public.current_user_organization_id())
) $$;

revoke all on function public.current_user_organization_id() from public;
revoke all on function public.current_user_is_platform_admin() from public;
grant execute on function public.current_user_organization_id() to authenticated;
grant execute on function public.current_user_is_platform_admin() to authenticated;

create or replace function public.current_user_can_access_tenant_event(target_event_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.events e join public.structures s on s.id = e.structure_id
    where e.id = target_event_id
      and (public.current_user_is_platform_admin() or s.organization_id = public.current_user_organization_id())
      and (
        public.current_user_is_active_admin()
        or (not public.current_user_is_active_co() and s.id = public.current_user_structure_id())
        or exists (select 1 from public.user_events ue where ue.event_id = e.id and ue.user_id = auth.uid())
      )
  )
$$;
revoke all on function public.current_user_can_access_tenant_event(uuid) from public;
grant execute on function public.current_user_can_access_tenant_event(uuid) to authenticated;

create or replace function public.current_user_can_access_tenant_intervention(
  target_event_id uuid, target_crew_id uuid, target_crew_ids uuid[]
)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.current_user_is_active_admin() or (
    public.current_user_can_access_tenant_event(target_event_id) and (
      public.current_user_is_active_co() or (
        public.current_user_crew_id() is not null and (
          target_crew_id = public.current_user_crew_id()
          or public.current_user_crew_id() = any(coalesce(target_crew_ids, '{}'::uuid[]))
        )
      )
    )
  )
$$;
revoke all on function public.current_user_can_access_tenant_intervention(uuid, uuid, uuid[]) from public;
grant execute on function public.current_user_can_access_tenant_intervention(uuid, uuid, uuid[]) to authenticated;

create or replace function public.prevent_platform_admin_escalation()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and old.is_platform_admin and new.role <> 'admin' then
    raise exception 'The platform administrator role must remain active';
  end if;
  if auth.uid() is not null and not public.current_user_is_platform_admin()
    and (new.is_platform_admin is distinct from old.is_platform_admin
      or (new.organization_id is distinct from old.organization_id and not (
        old.organization_id is null and new.organization_id = public.current_user_organization_id()
        and public.current_user_is_active_admin()
      ))) then
    raise exception 'Only platform administrators can change tenant ownership or platform access';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_platform_admin_guard on public.profiles;
create trigger profiles_platform_admin_guard before update on public.profiles
for each row execute function public.prevent_platform_admin_escalation();

alter table public.organizations enable row level security;
grant select, insert, update, delete on public.organizations to authenticated;

drop policy if exists organizations_read_tenant_or_platform on public.organizations;
create policy organizations_read_tenant_or_platform on public.organizations
for select to authenticated using (
  id = public.current_user_organization_id() or public.current_user_is_platform_admin()
);
drop policy if exists organizations_platform_manage on public.organizations;
create policy organizations_platform_manage on public.organizations
for all to authenticated using (public.current_user_is_platform_admin())
with check (public.current_user_is_platform_admin());

-- Tenant-owned configuration is filtered at the database boundary.
do $$
declare t text; p record;
begin
  foreach t in array array['profiles', 'structures', 'event_types', 'crew_types', 'settings'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.structures enable row level security;
alter table public.event_types enable row level security;
alter table public.crew_types enable row level security;
alter table public.settings enable row level security;

create policy profiles_read_same_tenant on public.profiles
for select to authenticated using (
  id = auth.uid() or organization_id = public.current_user_organization_id()
  or public.current_user_is_platform_admin()
);
create policy profiles_update_same_tenant on public.profiles
for update to authenticated using (
  public.current_user_is_platform_admin()
  or (public.current_user_is_active_admin() and (organization_id = public.current_user_organization_id() or organization_id is null))
) with check (
  public.current_user_is_platform_admin()
  or (public.current_user_is_active_admin() and organization_id = public.current_user_organization_id())
);

grant select, update on public.profiles to authenticated;

create policy structures_read_tenant on public.structures
for select to authenticated using (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin());
create policy structures_manage_tenant on public.structures
for all to authenticated using (public.current_user_is_active_admin() and (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin()))
with check (public.current_user_is_active_admin() and (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin()));

create policy event_types_read_tenant on public.event_types
for select to authenticated using (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin());
create policy event_types_manage_tenant on public.event_types
for all to authenticated using (public.current_user_is_active_admin() and (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin()))
with check (public.current_user_is_active_admin() and (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin()));

create policy crew_types_read_tenant on public.crew_types
for select to authenticated using (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin());
create policy crew_types_manage_tenant on public.crew_types
for all to authenticated using (public.current_user_is_active_admin() and (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin()))
with check (public.current_user_is_active_admin() and (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin()));

create policy settings_read_tenant on public.settings
for select to authenticated using (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin());
create policy settings_manage_tenant on public.settings
for all to authenticated using (public.current_user_is_active_admin() and (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin()))
with check (public.current_user_is_active_admin() and (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin()));

-- Child operational data inherits its tenant through its parent event/structure.
-- Replace permissive legacy policies to prevent cross-tenant OR access.
do $$
declare t text; p record;
begin
  foreach t in array array['events', 'zones', 'crews', 'interventions', 'user_events', 'event_posts', 'event_activity'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

create policy events_tenant_read on public.events for select to authenticated using (
  public.current_user_can_access_tenant_event(events.id)
);
create policy events_tenant_manage on public.events for all to authenticated using (
  public.current_user_is_active_admin() and (public.current_user_is_platform_admin() or exists (
    select 1 from public.structures s where s.id = events.structure_id and s.organization_id = public.current_user_organization_id()
  ))
) with check (
  public.current_user_is_active_admin() and (public.current_user_is_platform_admin() or exists (
    select 1 from public.structures s where s.id = events.structure_id and s.organization_id = public.current_user_organization_id()
  ))
);

create policy zones_tenant_read on public.zones for select to authenticated using (
  public.current_user_is_active_admin() and (public.current_user_is_platform_admin() or exists (
    select 1 from public.structures s where s.id = zones.structure_id and s.organization_id = public.current_user_organization_id()
  ))
  or exists (select 1 from public.events e where e.structure_id = zones.structure_id and public.current_user_can_access_tenant_event(e.id))
);
create policy zones_tenant_manage on public.zones for all to authenticated using (
  public.current_user_is_active_admin() and (public.current_user_is_platform_admin() or exists (
    select 1 from public.structures s where s.id = zones.structure_id and s.organization_id = public.current_user_organization_id()
  ))
) with check (
  public.current_user_is_active_admin() and (public.current_user_is_platform_admin() or exists (
    select 1 from public.structures s where s.id = zones.structure_id and s.organization_id = public.current_user_organization_id()
  ))
);

create policy crews_tenant_read on public.crews for select to authenticated using (
  public.current_user_is_active_admin() and (public.current_user_is_platform_admin() or exists (
    select 1 from public.structures s where s.id = crews.structure_id and s.organization_id = public.current_user_organization_id()
  ))
  or id = public.current_user_crew_id()
  or (public.current_user_is_active_co() and exists (
    select 1 from public.user_events ue join public.events e on e.id = ue.event_id
    where ue.user_id = auth.uid() and e.structure_id = crews.structure_id
      and public.current_user_can_access_tenant_event(e.id)
  ))
  or exists (select 1 from public.interventions i where i.crew_id = crews.id or crews.id = any(coalesce(i.crew_ids, '{}'::uuid[])))
);
create policy crews_tenant_manage on public.crews for all to authenticated using (
  public.current_user_is_active_admin() and (public.current_user_is_platform_admin() or exists (
    select 1 from public.structures s where s.id = crews.structure_id and s.organization_id = public.current_user_organization_id()
  ))
) with check (
  public.current_user_is_active_admin() and (public.current_user_is_platform_admin() or exists (
    select 1 from public.structures s where s.id = crews.structure_id and s.organization_id = public.current_user_organization_id()
  ))
);
create policy crews_own_status_update on public.crews for update to authenticated
using (id = public.current_user_crew_id()) with check (id = public.current_user_crew_id());
create policy crews_co_status_update on public.crews for update to authenticated
using (public.current_user_is_active_co() and exists (
  select 1 from public.user_events ue join public.events e on e.id = ue.event_id
  where ue.user_id = auth.uid() and e.structure_id = crews.structure_id
    and public.current_user_can_access_tenant_event(e.id)
)) with check (public.current_user_is_active_co() and exists (
  select 1 from public.user_events ue join public.events e on e.id = ue.event_id
  where ue.user_id = auth.uid() and e.structure_id = crews.structure_id
    and public.current_user_can_access_tenant_event(e.id)
));

create policy interventions_tenant_read on public.interventions for select to authenticated using (
  public.current_user_can_access_tenant_intervention(event_id, crew_id, crew_ids)
);
create policy interventions_tenant_insert on public.interventions for insert to authenticated with check (
  public.current_user_is_active_admin() or (
    created_by = auth.uid() and public.current_user_can_access_tenant_event(event_id) and (
      (public.current_user_is_active_co() and crew_id is null and cardinality(coalesce(crew_ids, '{}'::uuid[])) = 0)
      or (public.current_user_crew_id() is not null and (
        crew_id = public.current_user_crew_id()
        or public.current_user_crew_id() = any(coalesce(crew_ids, '{}'::uuid[]))
      ))
    )
  )
);
create policy interventions_tenant_update on public.interventions for update to authenticated using (
  public.current_user_can_access_tenant_intervention(event_id, crew_id, crew_ids)
) with check (
  public.current_user_is_active_admin() or (
    public.current_user_can_access_tenant_event(event_id) and exists (
      select 1 from public.events e
      where e.id = event_id
        and (crew_id is null or exists (select 1 from public.crews c where c.id = crew_id and c.structure_id = e.structure_id))
        and not exists (
          select 1 from unnest(coalesce(crew_ids, '{}'::uuid[])) assigned(crew_id)
          where not exists (select 1 from public.crews c where c.id = assigned.crew_id and c.structure_id = e.structure_id)
        )
    )
  )
);
create policy interventions_tenant_delete on public.interventions for delete to authenticated using (
  public.current_user_is_active_admin() and (public.current_user_is_platform_admin() or exists (
    select 1 from public.events e join public.structures s on s.id = e.structure_id
    where e.id = interventions.event_id and s.organization_id = public.current_user_organization_id()
  ))
);

create policy user_events_tenant_read on public.user_events for select to authenticated using (
  user_id = auth.uid() or
  (public.current_user_is_active_admin() and public.current_user_can_access_tenant_event(user_events.event_id))
);
create policy user_events_tenant_manage on public.user_events for all to authenticated using (
  public.current_user_is_active_admin() and public.current_user_can_access_tenant_event(user_events.event_id)
) with check (
  public.current_user_is_active_admin() and public.current_user_can_access_tenant_event(user_events.event_id)
  and (public.current_user_is_platform_admin() or exists (
    select 1 from public.profiles p join public.events e on e.id = user_events.event_id
    join public.structures s on s.id = e.structure_id
    where p.id = user_events.user_id and p.organization_id = s.organization_id
  ))
);

create policy event_posts_tenant_read on public.event_posts for select to authenticated using (
  public.current_user_can_access_tenant_event(event_posts.event_id)
);
create policy event_posts_co_manage_assigned_tenant on public.event_posts
for all to authenticated using (
  public.current_user_is_active_co() and public.current_user_can_access_tenant_event(event_posts.event_id)
) with check (
  public.current_user_is_active_co() and public.current_user_can_access_tenant_event(event_posts.event_id)
  and exists (
    select 1 from public.events e join public.zones z on z.id = event_posts.zone_id
    where e.id = event_posts.event_id and z.structure_id = e.structure_id
  )
  and (event_posts.crew_id is null or exists (
    select 1 from public.events e join public.crews c on c.id = event_posts.crew_id
    where e.id = event_posts.event_id and c.structure_id = e.structure_id
  ))
);
create policy event_posts_tenant_manage on public.event_posts for all to authenticated using (
  public.current_user_is_active_admin() and public.current_user_can_access_tenant_event(event_posts.event_id)
) with check (
  public.current_user_is_active_admin() and public.current_user_can_access_tenant_event(event_posts.event_id)
  and exists (
    select 1 from public.events e join public.zones z on z.id = event_posts.zone_id
    where e.id = event_posts.event_id and z.structure_id = e.structure_id
      and (event_posts.crew_id is null or exists (select 1 from public.crews c where c.id = event_posts.crew_id and c.structure_id = e.structure_id))
  )
);

create policy event_activity_tenant_read on public.event_activity for select to authenticated using (
  public.current_user_can_access_tenant_event(event_activity.event_id)
);

comment on table public.organizations is 'Customer tenants. Slug can be used for subdomain routing after a customer-owned root domain is configured.';

-- ==== supabase/migrations/20261011_tenant_write_defaults.sql ====
-- Keep older clients and tenant administrators from creating unowned tenant
-- records. Platform administrators still pass the selected organization_id.
alter table public.structures
  alter column organization_id set default public.current_user_organization_id();
alter table public.event_types
  alter column organization_id set default public.current_user_organization_id();
alter table public.crew_types
  alter column organization_id set default public.current_user_organization_id();
alter table public.settings
  alter column organization_id set default public.current_user_organization_id();

drop policy if exists structures_manage_tenant on public.structures;
create policy structures_manage_tenant on public.structures
for all to authenticated
using (
  public.current_user_is_active_admin()
  and (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin())
)
with check (
  public.current_user_is_active_admin()
  and organization_id is not null
  and (
    (public.current_user_is_platform_admin() and exists (
      select 1 from public.organizations o where o.id = structures.organization_id and o.active
    ))
    or organization_id = public.current_user_organization_id()
  )
);

drop policy if exists event_types_manage_tenant on public.event_types;
create policy event_types_manage_tenant on public.event_types
for all to authenticated
using (
  public.current_user_is_active_admin()
  and (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin())
)
with check (
  public.current_user_is_active_admin()
  and organization_id is not null
  and (
    (public.current_user_is_platform_admin() and exists (
      select 1 from public.organizations o where o.id = event_types.organization_id and o.active
    ))
    or organization_id = public.current_user_organization_id()
  )
);

drop policy if exists crew_types_manage_tenant on public.crew_types;
create policy crew_types_manage_tenant on public.crew_types
for all to authenticated
using (
  public.current_user_is_active_admin()
  and (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin())
)
with check (
  public.current_user_is_active_admin()
  and organization_id is not null
  and (
    (public.current_user_is_platform_admin() and exists (
      select 1 from public.organizations o where o.id = crew_types.organization_id and o.active
    ))
    or organization_id = public.current_user_organization_id()
  )
);

drop policy if exists settings_manage_tenant on public.settings;
create policy settings_manage_tenant on public.settings
for all to authenticated
using (
  public.current_user_is_active_admin()
  and (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin())
)
with check (
  public.current_user_is_active_admin()
  and organization_id is not null
  and (
    (public.current_user_is_platform_admin() and exists (
      select 1 from public.organizations o where o.id = settings.organization_id and o.active
    ))
    or organization_id = public.current_user_organization_id()
  )
);

-- ==== supabase/migrations/20261012_security_privileges.sql ====
-- Restrict callable SECURITY DEFINER helpers to authenticated users.
-- Trigger functions are not application RPCs and receive no direct grants.
revoke all on function public.current_user_is_active_admin() from public, anon;
revoke all on function public.current_user_crew_id() from public, anon;
revoke all on function public.current_user_structure_id() from public, anon;
revoke all on function public.current_user_is_active_co() from public, anon;
revoke all on function public.current_user_can_access_event(uuid) from public, anon;
revoke all on function public.current_user_organization_id() from public, anon;
revoke all on function public.current_user_is_platform_admin() from public, anon;
revoke all on function public.current_user_is_active_admin() from public, anon;
revoke all on function public.current_user_can_access_tenant_event(uuid) from public, anon;
revoke all on function public.current_user_can_access_tenant_intervention(uuid, uuid, uuid[]) from public, anon;

grant execute on function public.current_user_is_active_admin() to authenticated;
grant execute on function public.current_user_crew_id() to authenticated;
grant execute on function public.current_user_structure_id() to authenticated;
grant execute on function public.current_user_is_active_co() to authenticated;
grant execute on function public.current_user_can_access_event(uuid) to authenticated;
grant execute on function public.current_user_organization_id() to authenticated;
grant execute on function public.current_user_is_platform_admin() to authenticated;
grant execute on function public.current_user_can_access_tenant_event(uuid) to authenticated;
grant execute on function public.current_user_can_access_tenant_intervention(uuid, uuid, uuid[]) to authenticated;

revoke all on function public.record_event_activity() from public, anon, authenticated;
revoke all on function public.prevent_platform_admin_escalation() from public, anon, authenticated;
revoke all on function public.prevent_intervention_identity_change() from public, anon, authenticated;
revoke all on function public.prevent_non_status_crew_changes() from public, anon, authenticated;

-- These legacy helpers are still used by signed-in authorization logic. Keep
-- authenticated access, but do not expose them to anonymous API callers.
revoke all on function public.app_crew() from public, anon;
revoke all on function public.app_role() from public, anon;
grant execute on function public.app_crew() to authenticated;
grant execute on function public.app_role() to authenticated;

-- Trigger entry points must never be callable as direct RPCs.
revoke all on function public.guard_intervention() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.log_intervention() from public, anon, authenticated;
revoke all on function public.set_intervention_number() from public, anon, authenticated;

-- ==== supabase/migrations/20261013_admin_audit.sql ====
-- Administrative audit trail. Store changed field names, never patient values.
create schema if not exists private;

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid,
  actor_id uuid,
  table_name text not null,
  record_id text,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE', 'EXPORT')),
  changed_fields text[] not null default '{}',
  occurred_at timestamptz not null default now()
);

create index if not exists admin_audit_org_time_idx
  on public.admin_audit_log (organization_id, occurred_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
grant select on public.admin_audit_log to authenticated;

drop policy if exists admin_audit_read_own_organization on public.admin_audit_log;
create policy admin_audit_read_own_organization on public.admin_audit_log
for select to authenticated using (
  public.current_user_is_active_admin()
  and (organization_id = public.current_user_organization_id() or public.current_user_is_platform_admin())
);

create or replace function private.record_admin_audit_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  old_row jsonb := '{}'::jsonb;
  new_row jsonb := '{}'::jsonb;
  row_data jsonb;
  target_org uuid;
  target_record text;
  changed text[] := '{}';
begin
  if tg_op <> 'INSERT' then old_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_row := to_jsonb(new); end if;
  row_data := case when tg_op = 'DELETE' then old_row else new_row end;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k.key order by k.key), '{}'::text[]) into changed
    from jsonb_object_keys(old_row || new_row) as k(key)
    where old_row -> k.key is distinct from new_row -> k.key and k.key <> 'updated_at';
  elsif tg_op = 'INSERT' then
    select coalesce(array_agg(k.key order by k.key), '{}'::text[]) into changed
    from jsonb_object_keys(new_row) as k(key)
    where k.key not in ('created_at', 'updated_at');
  end if;

  if tg_table_name = 'organizations' then
    target_org := nullif(row_data ->> 'id', '')::uuid;
  elsif row_data ? 'organization_id' then
    target_org := nullif(row_data ->> 'organization_id', '')::uuid;
  elsif row_data ? 'structure_id' then
    select s.organization_id into target_org from public.structures s
    where s.id = nullif(row_data ->> 'structure_id', '')::uuid;
  elsif row_data ? 'event_id' then
    select s.organization_id into target_org
    from public.events e join public.structures s on s.id = e.structure_id
    where e.id = nullif(row_data ->> 'event_id', '')::uuid;
  end if;

  target_record := coalesce(row_data ->> 'id', row_data ->> 'key');
  if tg_table_name = 'settings' and target_org is not null then
    target_record := target_org::text || ':' || coalesce(row_data ->> 'key', '');
  end if;
  insert into public.admin_audit_log (
    organization_id, actor_id, table_name, record_id, operation, changed_fields
  ) values (target_org, auth.uid(), tg_table_name, target_record, tg_op, changed);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.record_admin_audit_change() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'profiles', 'structures', 'zones', 'event_types',
    'crew_types', 'settings', 'events', 'crews', 'event_posts', 'user_events', 'interventions'
  ] loop
    execute format('drop trigger if exists admin_audit_change on public.%I', t);
    execute format(
      'create trigger admin_audit_change after insert or update or delete on public.%I for each row execute function private.record_admin_audit_change()',
      t
    );
  end loop;
end;
$$;

create or replace function public.record_organization_export(target_organization_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.current_user_is_active_admin() then
    raise exception 'Administrator access required';
  end if;
  if not public.current_user_is_platform_admin()
    and target_organization_id <> public.current_user_organization_id() then
    raise exception 'Organization access denied';
  end if;
  if not exists (select 1 from public.organizations o where o.id = target_organization_id and o.active) then
    raise exception 'Active organization not found';
  end if;
  insert into public.admin_audit_log (
    organization_id, actor_id, table_name, record_id, operation, changed_fields
  ) values (
    target_organization_id, auth.uid(), 'organizations', target_organization_id::text,
    'EXPORT', array['organization_data']::text[]
  );
end;
$$;
revoke all on function public.record_organization_export(uuid) from public, anon;
grant execute on function public.record_organization_export(uuid) to authenticated;

-- ==== supabase/migrations/20261014_lock_rls_auto_enable.sql ====
-- The platform-managed event-trigger helper is internal infrastructure, not
-- an application RPC. Keep it unavailable to API roles when present.
do $migration$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$migration$;
