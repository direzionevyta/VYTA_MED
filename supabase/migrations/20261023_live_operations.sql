alter table public.interventions
  add column if not exists vital_signs jsonb not null default '{}'::jsonb,
  add column if not exists treatments text,
  add column if not exists medications text;

create table if not exists public.event_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users(id),
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists event_messages_event_time_idx on public.event_messages (event_id, created_at desc);
alter table public.event_messages enable row level security;
grant select, insert on public.event_messages to authenticated;
drop policy if exists event_messages_read on public.event_messages;
create policy event_messages_read on public.event_messages for select to authenticated
  using (public.current_user_can_access_tenant_event(event_id));
drop policy if exists event_messages_send on public.event_messages;
create policy event_messages_send on public.event_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.current_user_can_access_tenant_event(event_id));
