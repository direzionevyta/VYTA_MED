-- Correct legacy event links when the venue exactly matches a saved structure,
-- or when the venue is an unambiguous part of that structure's name.
with candidates as (
  select e.id as event_id, s.id as structure_id, s.name as structure_name,
    count(*) over (partition by e.id) as match_count
  from public.events e
  join public.structures s on
    lower(btrim(e.venue)) = lower(btrim(s.name))
    or (length(btrim(e.venue)) >= 5 and lower(s.name) like '%' || lower(btrim(e.venue)) || '%')
), unique_matches as (
  select event_id, structure_id, structure_name
  from candidates where match_count = 1
)
update public.events e
set structure_id = u.structure_id, venue = u.structure_name
from unique_matches u
where e.id = u.event_id
  and e.structure_id is distinct from u.structure_id;
