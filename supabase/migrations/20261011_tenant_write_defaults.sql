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
