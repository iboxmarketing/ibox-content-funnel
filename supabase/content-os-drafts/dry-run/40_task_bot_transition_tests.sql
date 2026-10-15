-- LOCAL DRY-RUN ONLY. Proves the FINAL Task Bot transition function (Codex,
-- marketing-team-task-bot codex/sprint-9b-hardening @ a9ed78a,
-- 20261014130332_content_os_task_transition_compatibility.sql, read via
-- `git show`, never edited) against Content OS drafts 00..06, as real
-- transitions run by service_role. Asserts the approved lifecycle:
-- revision parks the SAME Head Review BLOCKED, resubmission restores it
-- ASSIGNED, the reviewer accepts and completes it.
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

-- A second Blog + Head Review pair for the REVIEW -> DONE bypass check.
with x as (insert into public.content_blogs (knowledge_node_id, title) values (ref.id('node'), 'Blog C') returning id) select ref.put('blogC', id) from x;
select ref.task('blog3', 'author'); select ref.task('hr3', 'reviewer');
insert into public.content_task_runtime (task_id, task_type_version_id, source_task_id) values
  (ref.id('blog3'), ref.id('v_BLOG'), ref.id('research')), (ref.id('hr3'), ref.id('v_HEAD_REVIEW'), ref.id('blog3'));
insert into public.content_task_links (task_id, entity_type, entity_id, relation) values
  (ref.id('blog3'), 'BLOG', ref.id('blogC'), 'PRIMARY'), (ref.id('hr3'), 'BLOG', ref.id('blogC'), 'PRIMARY');
-- ref.status/ref.events are STABLE: read them in a statement AFTER the transition (same-statement reads see the old snapshot).
create function ref.status(p_k text) returns text language sql stable as $$ select status from public.tasks where id = ref.id(p_k) $$;
create function ref.events(p_k text, p_type text) returns bigint language sql stable as $$ select count(*) from public.task_events where task_id = ref.id(p_k) and event_type = p_type $$;
grant execute on all functions in schema ref to service_role;

set role service_role;
select ref.ok(ref.status('hr') = 'IN_PROGRESS', 'TB the Head Review starts IN_PROGRESS (autostart)');
select ref.ok(ref.try(ref.id('blog'), ref.id('other'), 'DONE') = '42501', 'TB Blog direct DONE refused for a non-assignee');
select ref.ok(ref.try(ref.id('blog'), ref.id('author'), 'DONE') = 'OK', 'TB Blog IN_PROGRESS -> DONE by its assignee (not review-required)');
select ref.ok(ref.try(ref.id('blog'), ref.id('other'), 'REVISION', 'x') = '42501', 'TB unrelated member cannot send the Blog back');
select ref.ok(ref.try(ref.id('blog'), ref.id('author'), 'REVISION', 'x') = '42501', 'TB Blog author cannot send their own Blog back');
select ref.ok(ref.try(ref.id('blog'), ref.id('reviewer'), 'REVISION', 'Kirishni qisqartiring') = 'OK', 'TB the Head Review assignee sends the SAME Blog DONE -> REVISION');
select ref.ok(ref.status('blog') = 'REVISION' and ref.status('hr') = 'BLOCKED', 'TB revision atomically parks the SAME Head Review IN_PROGRESS -> BLOCKED');
select ref.ok((select blocked_reason = 'Waiting for source Blog revision' from public.tasks where id = ref.id('hr')), 'TB parked review carries the blocked reason');
select ref.ok((select metadata ->> 'reviewTaskId' = ref.id('hr')::text from public.task_events where task_id = ref.id('blog') and event_type = 'REVISION_REQUESTED'),
  'TB REVISION_REQUESTED event records the deciding Head Review (reviewTaskId)');
select ref.ok((select count(*) = 1 from public.task_events where task_id = ref.id('hr') and event_type = 'TASK_BLOCKED'
  and metadata ->> 'sourceTaskId' = ref.id('blog')::text and (metadata ->> 'coupledContentOsTransition')::boolean), 'TB coupled TASK_BLOCKED event on the review (sourceTaskId, coupledContentOsTransition)');
select ref.ok((select count(*) from public.task_revisions where task_id = ref.id('blog') and requested_by = ref.id('reviewer')) = 1, 'TB task_revisions row appended');
select ref.ok(ref.try(ref.id('hr'), ref.id('reviewer'), 'DONE') = '40001', 'TB a BLOCKED Head Review cannot complete');
select ref.ok(ref.try(ref.id('blog'), ref.id('reviewer'), 'DONE') = '42501', 'TB only the Blog assignee resubmits');
select ref.ok(ref.try(ref.id('blog'), ref.id('author'), 'DONE') = 'OK', 'TB corrected Blog REVISION -> DONE by its assignee (same task)');
select ref.ok(ref.status('blog') = 'DONE' and ref.status('hr') = 'ASSIGNED', 'TB resubmission atomically restores the SAME Head Review BLOCKED -> ASSIGNED');
select ref.ok((select blocked_reason is null from public.tasks where id = ref.id('hr')) and ref.events('hr', 'TASK_UNBLOCKED') = 1, 'TB blocked reason cleared, coupled TASK_UNBLOCKED event');
select ref.ok(ref.try(ref.id('blog'), ref.id('author'), 'DONE') = 'OK', 'TB a retried resubmission returns OK');
select ref.ok(ref.events('blog', 'TASK_COMPLETED') = 2, 'TB ...and is a no-op (no extra event)');
select ref.ok(ref.try(ref.id('hr'), ref.id('reviewer'), 'DONE') = '40001', 'TB an ASSIGNED Head Review must be accepted before deciding');
select ref.ok(ref.try(ref.id('blog'), ref.id('head'), 'REVISION', 'x') <> 'OK', 'TB no revision while the review is ASSIGNED (not yet accepted)');
select ref.ok(ref.status('blog') = 'DONE', 'TB ...the Blog stays DONE');
select ref.ok(ref.try(ref.id('hr'), ref.id('reviewer'), 'IN_PROGRESS') = 'OK', 'TB reviewer accepts the SAME Head Review ASSIGNED -> IN_PROGRESS');
select ref.ok(ref.try(ref.id('blog'), ref.id('head'), 'REVISION', 'Head decision') = 'OK', 'TB second cycle: the active Head decides');
select ref.ok(ref.status('hr') = 'BLOCKED', 'TB ...the SAME review is parked again');
select ref.ok(ref.try(ref.id('blog'), ref.id('author'), 'DONE') = 'OK', 'TB second correction');
select ref.ok(ref.status('hr') = 'ASSIGNED', 'TB ...restores the SAME review again');
select ref.ok((select count(*) from public.tasks where id in (select task_id from public.content_task_runtime where source_task_id = ref.id('blog') and task_type_version_id = ref.id('v_HEAD_REVIEW'))) = 1, 'TB still exactly one Head Review for the Blog');
select ref.ok(ref.try(ref.id('hr'), ref.id('reviewer'), 'IN_PROGRESS') = 'OK' and ref.try(ref.id('hr'), ref.id('reviewer'), 'DONE') = 'OK', 'TB the SAME Head Review is accepted and approved (DONE)');
select ref.ok(ref.try(ref.id('blog'), ref.id('reviewer'), 'REVISION', 'late') = '42501', 'TB a completed Head Review cannot reopen the Blog');

-- REVIEW -> DONE bypass is closed and coupled changes are all-or-nothing.
select ref.ok(ref.try(ref.id('blog3'), ref.id('author'), 'DONE') = 'OK' and ref.try(ref.id('blog3'), ref.id('reviewer'), 'REVISION', 'x') = 'OK', 'TB pair 3: Blog DONE -> REVISION');
select ref.ok(ref.try(ref.id('hr3'), ref.id('reviewer'), 'IN_PROGRESS', null) = 'OK' and ref.try(ref.id('hr3'), ref.id('reviewer'), 'REVIEW') = 'OK', 'TB pair 3: review resumed out of band and sent to REVIEW (legacy paths)');
select ref.ok(ref.try(ref.id('hr3'), ref.id('head'), 'DONE') = '40001', 'TB REVIEW -> DONE of a Head Review is refused while its Blog is in REVISION');
select ref.ok(ref.try(ref.id('blog3'), ref.id('author'), 'DONE') = '40001', 'TB resubmission refuses when the parked review is not BLOCKED');
select ref.ok(ref.status('blog3') = 'REVISION' and ref.status('hr3') = 'REVIEW', 'TB ...nothing half-applied');
reset role;
select ref.force('research', 'DONE'); select ref.force('seo', 'DONE'); select ref.force('lonely_blog', 'DONE');
set role service_role;
select ref.ok(ref.try(ref.id('research'), ref.id('head'), 'REVISION', 'x') = '42501', 'TB a DONE Research task cannot be sent to REVISION (even by Head)');
select ref.ok(ref.try(ref.id('seo'), ref.id('head'), 'REVISION', 'x') = '42501', 'TB a DONE SEO task (same source + Blog) cannot be sent to REVISION');
select ref.ok(ref.try(ref.id('lonely_blog'), ref.id('head'), 'REVISION', 'x') = '42501', 'TB a DONE Blog without its own Head Review cannot be sent to REVISION');
select ref.ok(ref.try(ref.id('reviewed'), ref.id('author'), 'DONE') = '40001', 'TB a review-required Content OS task cannot complete directly');
select ref.ok(ref.try(ref.id('reviewed'), ref.id('author'), 'REVIEW') = 'OK' and ref.try(ref.id('reviewed'), ref.id('head'), 'DONE') = 'OK', 'TB ...it completes via REVIEW -> DONE');
select ref.ok(ref.try(ref.id('legacy'), ref.id('author'), 'DONE') = '40001', 'TB legacy task: IN_PROGRESS -> DONE still refused');
select ref.ok(ref.try(ref.id('legacy'), ref.id('author'), 'REVIEW') = 'OK' and ref.try(ref.id('legacy'), ref.id('head'), 'DONE') = 'OK', 'TB legacy task: REVIEW -> DONE unchanged');
select ref.ok(ref.try(ref.id('legacy'), ref.id('head'), 'REVISION') = '40001', 'TB legacy task: DONE -> REVISION still refused');
select ref.ok((select count(*) from public.task_events where task_id = ref.id('legacy') and metadata ? 'reviewTaskId') = 0, 'TB legacy events carry no reviewTaskId');
reset role;
\echo 'ALL TASK BOT TRANSITION TESTS PASSED'
