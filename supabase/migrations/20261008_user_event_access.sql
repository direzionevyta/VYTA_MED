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
