-- LOCAL DRY-RUN ONLY. Never run against Supabase: these roles already exist
-- there. Recreates the minimum of Supabase's role model that the task-bot
-- and Content OS migrations reference (grants to anon / authenticated /
-- service_role). service_role bypasses RLS on Supabase, so it does here too.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

-- Emulate the existing Supabase postgres/public default table privileges.
-- Live project currently gives these privileges to anon/authenticated/service_role
-- when postgres creates a new table. Content OS migrations must explicitly
-- REVOKE ALL before granting the intended least-privilege service_role access.
alter default privileges for role postgres in schema public
  grant truncate, references, trigger, maintain on tables
  to anon, authenticated, service_role;
