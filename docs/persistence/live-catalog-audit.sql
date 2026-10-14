-- Sprint 8A — LIVE SUPABASE CATALOG AUDIT (project cbjcclefgxrdyjwkjcpq)
--
-- READ-ONLY. Every statement is a SELECT against pg_catalog /
-- information_schema. Run it in a READ ONLY transaction so a typo can never
-- mutate anything:
--
--   psql "$READ_ONLY_DB_URL" -v ON_ERROR_STOP=1 -f live-catalog-audit.sql > live-catalog.txt
--
-- Then classify live-catalog.txt against docs/persistence/repo-catalog-baseline.txt
-- (this exact script run on a local database built only from the 8 task-bot
-- migrations, via supabase/content-os-drafts/dry-run/load-taskbot-baseline.sh):
--
--   python3 docs/persistence/compare-catalog.py docs/persistence/repo-catalog-baseline.txt live-catalog.txt
--
-- Visibility caveat (found in the 2026-10-14 live audit): information_schema
-- only shows objects the connected role has privileges on, so a restricted
-- auditor role can see MISSING_IN_LIVE triggers/grants that do exist.
-- Re-check any such row directly in pg_catalog (pg_trigger, pg_class.relacl,
-- pg_proc.proacl, pg_namespace.nspacl) before calling it drift.

begin transaction read only;

\echo '== tables in scope'
select c.relname, c.relkind, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by 1;

\echo '== columns'
select table_name, ordinal_position, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('users','tasks','task_events','deadline_change_requests','reassign_requests','task_revisions',
    'recurring_definitions','task_checklists','task_checklist_items','report_deliveries','user_events','task_reminder_deliveries')
order by table_name, ordinal_position;

\echo '== constraints (PK / FK / UNIQUE / CHECK) with exact names, definitions and FK actions'
select cl.relname as table_name, con.conname, con.contype,
  pg_get_constraintdef(con.oid, true) as definition,
  con.confupdtype as fk_on_update, con.confdeltype as fk_on_delete
from pg_constraint con
join pg_class cl on cl.oid = con.conrelid
join pg_namespace n on n.oid = cl.relnamespace
where n.nspname = 'public'
order by 1, 2;

\echo '== indexes (incl. partial predicates)'
select tablename, indexname, indexdef
from pg_indexes where schemaname = 'public'
order by 1, 2;

\echo '== triggers'
select event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where event_object_schema = 'public'
order by 1, 2, 4;

\echo '== functions (public + private): signature, security, search_path, volatility'
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as returns,
  case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end as security,
  p.proconfig as config, p.provolatile, md5(p.prosrc) as body_md5
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
order by 1, 2, 3;

\echo '== table grants'
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
group by 1, 2 order by 1, 2;

\echo '== routine grants'
select routine_schema, routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema in ('public', 'private')
order by 1, 2, 3;

\echo '== schema privileges'
select n.nspname, r.rolname,
  has_schema_privilege(r.rolname, n.nspname, 'USAGE') as usage,
  has_schema_privilege(r.rolname, n.nspname, 'CREATE') as create_priv
from pg_namespace n cross join pg_roles r
where n.nspname in ('public', 'private') and r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')
order by 1, 2;

\echo '== RLS policies'
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public', 'private')
order by 1, 2, 3;

\echo '== default privileges'
select pg_get_userbyid(d.defaclrole) as owner, n.nspname, d.defaclobjtype, d.defaclacl
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
order by 1, 2, 3;

\echo '== applied migration history (Supabase CLI ledger, if present)'
select to_regclass('supabase_migrations.schema_migrations') is not null as has_ledger \gset
\if :has_ledger
select version, name from supabase_migrations.schema_migrations order by version;
\else
\echo 'no supabase_migrations.schema_migrations ledger in this database'
\endif

rollback;
