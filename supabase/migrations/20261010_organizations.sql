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
where lower(email) = lower('putellisimone24@gmail.com') and active and role = 'admin';

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
