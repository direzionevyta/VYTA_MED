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
