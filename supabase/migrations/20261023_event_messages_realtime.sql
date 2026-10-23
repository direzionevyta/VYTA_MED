do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'event_messages'
  ) then
    alter publication supabase_realtime add table public.event_messages;
  end if;
end
$$;
