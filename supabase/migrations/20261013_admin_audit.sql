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
