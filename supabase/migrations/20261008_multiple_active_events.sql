-- The application supports selecting among multiple events in corso.
-- Remove a unique constraint on events.status, if one was created, and any
-- partial unique index that only allowed one row with status = 'in_corso'.
do $$
declare
  c record;
  i record;
  status_attnum smallint;
begin
  select attnum into status_attnum
  from pg_attribute
  where attrelid = 'public.events'::regclass and attname = 'status' and not attisdropped;

  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.events'::regclass
      and contype = 'u'
      and conkey = array[status_attnum]::smallint[]
  loop
    execute format('alter table public.events drop constraint %I', c.conname);
  end loop;

  for i in
    select idx.indexrelid::regclass as index_name
    from pg_index idx
    where idx.indrelid = 'public.events'::regclass
      and idx.indisunique
      and idx.indpred is not null
      and pg_get_expr(idx.indpred, idx.indrelid) ilike '%status%'
      and pg_get_expr(idx.indpred, idx.indrelid) ilike '%in_corso%'
  loop
    execute format('drop index if exists %s', i.index_name);
  end loop;
end $$;
