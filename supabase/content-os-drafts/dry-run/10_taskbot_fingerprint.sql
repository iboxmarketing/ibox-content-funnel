-- LOCAL DRY-RUN ONLY. One md5 over every task-bot catalog object (12 tables:
-- columns, constraints, indexes, triggers, grants, RLS, policies; and all
-- non-Content-OS functions in public/private incl. bodies, security, config,
-- routine grants). Must be identical before and after the Content OS drafts.
with bot_tables(t) as (values
  ('users'), ('tasks'), ('task_events'), ('deadline_change_requests'), ('reassign_requests'), ('task_revisions'),
  ('recurring_definitions'), ('task_checklists'), ('task_checklist_items'), ('report_deliveries'), ('user_events'), ('task_reminder_deliveries')
), parts as (
  select 'col|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '') as line
  from information_schema.columns where table_schema = 'public' and table_name in (select t from bot_tables)
  union all
  select 'con|' || cl.relname || '|' || con.conname || '|' || pg_get_constraintdef(con.oid, true) || '|' || con.confdeltype::text || con.confupdtype::text
  from pg_constraint con join pg_class cl on cl.oid = con.conrelid
  where cl.relnamespace = 'public'::regnamespace and cl.relname in (select t from bot_tables)
  union all
  select 'idx|' || indexdef from pg_indexes where schemaname = 'public' and tablename in (select t from bot_tables)
  union all
  select 'trg|' || pg_get_triggerdef(tg.oid) from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid
  where not tg.tgisinternal and cl.relnamespace = 'public'::regnamespace and cl.relname in (select t from bot_tables)
  union all
  select 'grant|' || table_name || '|' || grantee || '|' || privilege_type
  from information_schema.role_table_grants where table_schema = 'public' and table_name in (select t from bot_tables)
  union all
  select 'rls|' || relname || '|' || relrowsecurity::text || '|' || relforcerowsecurity::text
  from pg_class where relnamespace = 'public'::regnamespace and relname in (select t from bot_tables)
  union all
  select 'pol|' || tablename || '|' || policyname from pg_policies where schemaname = 'public' and tablename in (select t from bot_tables)
  union all
  select 'fn|' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || md5(p.prosrc)
    || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || coalesce(array_to_string(p.proacl, ','), '')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.proname not like 'content_os%'
)
select count(*) || ' objects, md5 ' || md5(string_agg(line, E'\n' order by line)) from parts;
