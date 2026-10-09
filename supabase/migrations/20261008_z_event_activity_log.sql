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
