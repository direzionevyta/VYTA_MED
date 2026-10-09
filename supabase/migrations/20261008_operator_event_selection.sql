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
