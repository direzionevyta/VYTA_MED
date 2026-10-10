-- The platform-managed event-trigger helper is internal infrastructure, not
-- an application RPC. Keep it unavailable to API roles when present.
do $migration$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$migration$;
