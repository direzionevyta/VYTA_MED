-- Support multiple responding crews on one intervention.
-- The primary crew_id column remains the lead crew for older clients/reports.
alter table public.interventions
  add column if not exists crew_ids uuid[] not null default '{}'::uuid[];

-- Backfill existing lead crews so old interventions display consistently.
update public.interventions
set crew_ids = array[crew_id]
where crew_id is not null and cardinality(crew_ids) = 0;
