-- Restrict callable SECURITY DEFINER helpers to authenticated users.
-- Trigger functions are not application RPCs and receive no direct grants.
revoke all on function public.current_user_is_active_admin() from public, anon;
revoke all on function public.current_user_crew_id() from public, anon;
revoke all on function public.current_user_structure_id() from public, anon;
revoke all on function public.current_user_is_active_co() from public, anon;
revoke all on function public.current_user_can_access_event(uuid) from public, anon;
revoke all on function public.current_user_organization_id() from public, anon;
revoke all on function public.current_user_is_platform_admin() from public, anon;
revoke all on function public.current_user_is_active_admin() from public, anon;
revoke all on function public.current_user_can_access_tenant_event(uuid) from public, anon;
revoke all on function public.current_user_can_access_tenant_intervention(uuid, uuid, uuid[]) from public, anon;

grant execute on function public.current_user_is_active_admin() to authenticated;
grant execute on function public.current_user_crew_id() to authenticated;
grant execute on function public.current_user_structure_id() to authenticated;
grant execute on function public.current_user_is_active_co() to authenticated;
grant execute on function public.current_user_can_access_event(uuid) to authenticated;
grant execute on function public.current_user_organization_id() to authenticated;
grant execute on function public.current_user_is_platform_admin() to authenticated;
grant execute on function public.current_user_can_access_tenant_event(uuid) to authenticated;
grant execute on function public.current_user_can_access_tenant_intervention(uuid, uuid, uuid[]) to authenticated;

revoke all on function public.record_event_activity() from public, anon, authenticated;
revoke all on function public.prevent_platform_admin_escalation() from public, anon, authenticated;
revoke all on function public.prevent_intervention_identity_change() from public, anon, authenticated;
revoke all on function public.prevent_non_status_crew_changes() from public, anon, authenticated;
