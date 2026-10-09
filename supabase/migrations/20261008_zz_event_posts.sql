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
