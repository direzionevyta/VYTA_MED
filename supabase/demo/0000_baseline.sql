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
