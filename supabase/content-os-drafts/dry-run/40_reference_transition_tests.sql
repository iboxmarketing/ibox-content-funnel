-- LOCAL DRY-RUN ONLY. Proves the REFERENCE Task Bot transition function
-- (docs/persistence/reference/transition_task_with_events.sprint9b.sql)
-- against Content OS drafts 00..06, as real transitions run by service_role.
create schema if not exists ref;
create function ref.ok(p_condition boolean, p_label text) returns void language plpgsql as $$
begin
  if p_condition is not true then raise exception 'FAIL %', p_label; end if;
  raise notice 'PASS %', p_label;
end $$;
create function ref.try(p_task uuid, p_actor uuid, p_to text, p_reason text default null) returns text language plpgsql as $$
begin
  perform public.transition_task_with_events(p_task, p_actor, p_to, p_reason);
  return 'OK';
exception when others then return sqlstate;
end $$;
create table ref.ids (k text primary key, v uuid not null);
create function ref.id(p_k text) returns uuid language sql stable as $$ select v from ref.ids where k = p_k $$;
create function ref.put(p_k text, p_v uuid) returns uuid language sql as $$ insert into ref.ids values (p_k, p_v) returning v $$;

insert into public.users (telegram_user_id, display_name, role, is_active) values
  (3001, 'Head', 'HEAD_OF_MARKETING', true), (3002, 'Author', 'CONTENT_MARKETER', true),
  (3003, 'Reviewer', 'DIGITAL_MARKETER', true), (3004, 'Other', 'SMM_MANAGER', true);
select ref.put('head', id) from public.users where telegram_user_id = 3001;
select ref.put('author', id) from public.users where telegram_user_id = 3002;
select ref.put('reviewer', id) from public.users where telegram_user_id = 3003;
select ref.put('other', id) from public.users where telegram_user_id = 3004;
create function ref.task(p_k text, p_assignee text) returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from public.create_task_with_event_v2(ref.id('head'), ref.id(p_assignee), p_k, '', 'normal', now() + interval '2 days');
  return ref.put(p_k, v);
end $$;
create function ref.force(p_k text, p_status text) returns void language sql as $$
  update public.tasks set status = p_status, completed_at = case when p_status = 'DONE' then now() end where id = ref.id(p_k)
$$;
grant usage on schema ref to service_role;
grant execute on all functions in schema ref to service_role;
grant select, insert on ref.ids to service_role;

-- Content OS config + content.
insert into public.content_domains (name) values ('Ombor');
insert into public.content_problem_categories (domain_id, name) select id, 'Qoldiq' from public.content_domains;
insert into public.content_problem_parts (problem_category_id, name) select id, 'Hisobda kam' from public.content_problem_categories;
with x as (insert into public.content_knowledge_nodes (problem_part_id, name) select id, 'Qaytgan tovar' from public.content_problem_parts returning id) select ref.put('node', id) from x;
with x as (insert into public.content_blogs (knowledge_node_id, title) values (ref.id('node'), 'Blog A') returning id) select ref.put('blogA', id) from x;
with x as (insert into public.content_blogs (knowledge_node_id, title) values (ref.id('node'), 'Blog B') returning id) select ref.put('blogB', id) from x;
create function ref.version(p_code text, p_review boolean) returns uuid language plpgsql as $$
declare t uuid; v uuid;
begin
  insert into public.content_task_types (code) values (p_code) returning id into t;
  insert into public.content_task_type_versions (task_type_id, version, name, definition, review_required) values (t, 1, p_code, '{}', p_review) returning id into v;
  update public.content_task_types set current_version_id = v where id = t;
  return ref.put('v_' || p_code, v);
end $$;
select ref.version('BLOG', false); select ref.version('HEAD_REVIEW', false); select ref.version('SEO', false);
select ref.version('RESEARCH', false); select ref.version('REVIEWED_THING', true);

select ref.task('research', 'author'); select ref.task('blog', 'author'); select ref.task('hr', 'reviewer');
select ref.task('seo', 'other'); select ref.task('lonely_blog', 'author'); select ref.task('reviewed', 'author'); select ref.task('legacy', 'author');
insert into public.content_task_runtime (task_id, task_type_version_id, source_task_id) values
  (ref.id('research'), ref.id('v_RESEARCH'), null), (ref.id('blog'), ref.id('v_BLOG'), ref.id('research')),
  (ref.id('hr'), ref.id('v_HEAD_REVIEW'), ref.id('blog')), (ref.id('seo'), ref.id('v_SEO'), ref.id('blog')),
  (ref.id('lonely_blog'), ref.id('v_BLOG'), ref.id('research')), (ref.id('reviewed'), ref.id('v_REVIEWED_THING'), null);
insert into public.content_task_links (task_id, entity_type, entity_id, relation) values
  (ref.id('research'), 'KNOWLEDGE_NODE', ref.id('node'), 'PRIMARY'),
  (ref.id('blog'), 'BLOG', ref.id('blogA'), 'PRIMARY'), (ref.id('blog'), 'KNOWLEDGE_NODE', ref.id('node'), 'RELATED'),
  (ref.id('hr'), 'BLOG', ref.id('blogA'), 'PRIMARY'), (ref.id('hr'), 'KNOWLEDGE_NODE', ref.id('node'), 'RELATED'),
  (ref.id('seo'), 'BLOG', ref.id('blogA'), 'PRIMARY'), (ref.id('lonely_blog'), 'BLOG', ref.id('blogB'), 'PRIMARY');

set role service_role;
select ref.ok(ref.try(ref.id('blog'), ref.id('other'), 'DONE') = '42501', 'REF Blog direct DONE refused for a non-assignee');
select ref.ok(ref.try(ref.id('blog'), ref.id('author'), 'DONE') = 'OK', 'REF Blog IN_PROGRESS -> DONE by its assignee (not review-required)');
select ref.ok(ref.try(ref.id('blog'), ref.id('other'), 'REVISION', 'x') = '42501', 'REF unrelated member cannot send the Blog back');
select ref.ok(ref.try(ref.id('blog'), ref.id('author'), 'REVISION', 'x') = '42501', 'REF Blog author cannot send their own Blog back');
select ref.ok(ref.try(ref.id('blog'), ref.id('reviewer'), 'REVISION', 'Kirishni qisqartiring') = 'OK', 'REF the Head Review assignee sends the SAME Blog DONE -> REVISION');
select ref.ok((select metadata ->> 'reviewTaskId' = ref.id('hr')::text from public.task_events where task_id = ref.id('blog') and event_type = 'REVISION_REQUESTED'),
  'REF REVISION_REQUESTED event records the deciding Head Review (reviewTaskId)');
select ref.ok((select count(*) from public.task_revisions where task_id = ref.id('blog') and requested_by = ref.id('reviewer')) = 1, 'REF task_revisions row appended');
select ref.ok(ref.try(ref.id('hr'), ref.id('reviewer'), 'DONE') = '40001', 'REF Head Review cannot complete while its Blog is in REVISION');
select ref.ok(ref.try(ref.id('blog'), ref.id('author'), 'DONE') = 'OK', 'REF corrected Blog REVISION -> DONE by its assignee (same task)');
select ref.ok(ref.try(ref.id('blog'), ref.id('head'), 'REVISION', 'Head decision') = 'OK', 'REF the active Head may also decide');
select ref.ok(ref.try(ref.id('blog'), ref.id('author'), 'DONE') = 'OK', 'REF second correction');
select ref.ok(ref.try(ref.id('hr'), ref.id('reviewer'), 'DONE') = 'OK', 'REF the SAME Head Review completes once its Blog is DONE');
select ref.ok(ref.try(ref.id('blog'), ref.id('reviewer'), 'REVISION', 'late') = '42501', 'REF a completed Head Review cannot reopen the Blog');
reset role;
select ref.force('research', 'DONE'); select ref.force('seo', 'DONE'); select ref.force('lonely_blog', 'DONE');
set role service_role;
select ref.ok(ref.try(ref.id('research'), ref.id('head'), 'REVISION', 'x') = '42501', 'REF a DONE Research task cannot be sent to REVISION (even by Head)');
select ref.ok(ref.try(ref.id('seo'), ref.id('head'), 'REVISION', 'x') = '42501', 'REF a DONE SEO task (same source + Blog) cannot be sent to REVISION');
select ref.ok(ref.try(ref.id('lonely_blog'), ref.id('head'), 'REVISION', 'x') = '42501', 'REF a DONE Blog without its own Head Review cannot be sent to REVISION');
select ref.ok(ref.try(ref.id('reviewed'), ref.id('author'), 'DONE') = '40001', 'REF a review-required Content OS task cannot complete directly');
select ref.ok(ref.try(ref.id('reviewed'), ref.id('author'), 'REVIEW') = 'OK' and ref.try(ref.id('reviewed'), ref.id('head'), 'DONE') = 'OK', 'REF ...it completes via REVIEW -> DONE');
select ref.ok(ref.try(ref.id('legacy'), ref.id('author'), 'DONE') = '40001', 'REF legacy task: IN_PROGRESS -> DONE still refused');
select ref.ok(ref.try(ref.id('legacy'), ref.id('author'), 'REVIEW') = 'OK' and ref.try(ref.id('legacy'), ref.id('head'), 'DONE') = 'OK', 'REF legacy task: REVIEW -> DONE unchanged');
select ref.ok(ref.try(ref.id('legacy'), ref.id('head'), 'REVISION') = '40001', 'REF legacy task: DONE -> REVISION still refused');
select ref.ok((select count(*) from public.task_events where task_id = ref.id('legacy') and metadata ? 'reviewTaskId') = 0, 'REF legacy events carry no reviewTaskId');
reset role;
\echo 'ALL REFERENCE TRANSITION TESTS PASSED'
