-- LOCAL DRY-RUN ONLY. Sprint 9B transition contract (migration 06).
-- Runs after 20_contract_tests.sql in the same database (reuses dryrun.*).
-- Task statuses are set directly as the migration owner: these tests prove
-- the Content OS predicates, not the Task Bot state machine.

insert into public.users (telegram_user_id, display_name, role, is_active) values
  (2001, 'Head 9B', 'HEAD_OF_MARKETING', false),
  (2002, 'Blog author', 'CONTENT_MARKETER', true),
  (2003, 'Assigned reviewer', 'DIGITAL_MARKETER', true),
  (2004, 'Unrelated member', 'SMM_MANAGER', true),
  (2005, 'Inactive reviewer', 'OPERATOR_VIDEO_EDITOR', false);
select dryrun.put('b_author', id) from public.users where telegram_user_id = 2002;
select dryrun.put('b_reviewer', id) from public.users where telegram_user_id = 2003;
select dryrun.put('b_other', id) from public.users where telegram_user_id = 2004;
select dryrun.put('b_inactive', id) from public.users where telegram_user_id = 2005;

create function dryrun.mk_task_for(p_key text, p_title text, p_assignee text) returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from public.create_task_with_event_v2(dryrun.id('b_author'), dryrun.id(p_assignee), p_title, '', 'normal', now() + interval '3 days');
  return dryrun.put(p_key, v);
end $$;
create function dryrun.set_status(p_task text, p_status text) returns void language sql as $$
  update public.tasks set status = p_status,
    completed_at = case when p_status = 'DONE' then now() end,
    cancelled_at = case when p_status = 'CANCELLED' then now() end,
    blocked_reason = case when p_status = 'BLOCKED' then 'waiting' end
  where id = dryrun.id(p_task)
$$;

-- Config: stable codes; BLOG v1 is not review-required.
with x as (insert into public.content_task_types (code) values ('SEO') returning id) select dryrun.put('tt_seo', id) from x;
with x as (insert into public.content_task_type_versions (task_type_id, version, name, definition) values (dryrun.id('tt_seo'), 1, 'SEO', '{}') returning id) select dryrun.put('ttv_seo_1', id) from x;
with x as (insert into public.content_task_types (code) values ('RESEARCH') returning id) select dryrun.put('tt_research', id) from x;
with x as (insert into public.content_task_type_versions (task_type_id, version, name, definition) values (dryrun.id('tt_research'), 1, 'Research', '{}') returning id) select dryrun.put('ttv_research_1', id) from x;
-- tt_blog (BLOG, versions 1 and 2) and tt_hr (HEAD_REVIEW, version 1) come from 20_contract_tests.sql.
select dryrun.ok((select review_required from public.content_task_type_versions where id = dryrun.id('ttv_blog_1')) = false, '9B BLOG v1 is not review-required (Sprint 7.1 product decision)');

-- Content: two Blog entities under the same node.
with x as (insert into public.content_blogs (knowledge_node_id, title) values (dryrun.id('node2'), 'Inventarizatsiya — blog') returning id) select dryrun.put('blog_entity_1', id) from x;
with x as (insert into public.content_blogs (knowledge_node_id, title) values (dryrun.id('node2'), 'Second blog on the node') returning id) select dryrun.put('blog_entity_2', id) from x;

-- Tasks: Blog 1, its Head Review, its SEO, a second Blog, a Head Review
-- whose PRIMARY Blog differs from its source's, and a Research task.
select dryrun.mk_task_for('t_blog1', 'Blog 1', 'b_author');
select dryrun.mk_task_for('t_hr1', 'Head Review 1', 'b_reviewer');
select dryrun.mk_task_for('t_seo1', 'SEO 1', 'b_other');
select dryrun.mk_task_for('t_blog2', 'Blog 2', 'b_author');
select dryrun.mk_task_for('t_hr_mismatch', 'Head Review mismatch', 'b_reviewer');
select dryrun.mk_task_for('t_research9b', 'Research 9B', 'b_author');

insert into public.content_task_runtime (task_id, task_type_version_id, source_task_id) values
  (dryrun.id('t_blog1'), dryrun.id('ttv_blog_1'), dryrun.id('t_research9b')),
  (dryrun.id('t_hr1'), dryrun.id('ttv_hr_1'), dryrun.id('t_blog1')),
  (dryrun.id('t_seo1'), dryrun.id('ttv_seo_1'), dryrun.id('t_blog1')),
  (dryrun.id('t_blog2'), dryrun.id('ttv_blog_1'), dryrun.id('t_research9b')),
  (dryrun.id('t_hr_mismatch'), dryrun.id('ttv_hr_1'), dryrun.id('t_blog1')),
  (dryrun.id('t_research9b'), dryrun.id('ttv_research_1'), null);
insert into public.content_task_links (task_id, entity_type, entity_id, relation) values
  (dryrun.id('t_blog1'), 'BLOG', dryrun.id('blog_entity_1'), 'PRIMARY'),
  (dryrun.id('t_blog1'), 'KNOWLEDGE_NODE', dryrun.id('node2'), 'RELATED'),
  (dryrun.id('t_hr1'), 'BLOG', dryrun.id('blog_entity_1'), 'PRIMARY'),
  (dryrun.id('t_hr1'), 'KNOWLEDGE_NODE', dryrun.id('node2'), 'RELATED'),
  (dryrun.id('t_seo1'), 'BLOG', dryrun.id('blog_entity_1'), 'PRIMARY'),
  (dryrun.id('t_blog2'), 'BLOG', dryrun.id('blog_entity_2'), 'PRIMARY'),
  (dryrun.id('t_hr_mismatch'), 'BLOG', dryrun.id('blog_entity_2'), 'PRIMARY'),
  (dryrun.id('t_research9b'), 'KNOWLEDGE_NODE', dryrun.id('node2'), 'PRIMARY');

-- 1. Blog task's PRIMARY relation is the Blog entity.
select dryrun.ok((select entity_type = 'BLOG' and entity_id = dryrun.id('blog_entity_1') from public.content_task_links where task_id = dryrun.id('t_blog1') and relation = 'PRIMARY'),
  '9B-1 Blog task has a PRIMARY BLOG entity relation');
select dryrun.ok(public.content_os_task_type_code(dryrun.id('t_blog1')) = 'BLOG' and public.content_os_task_type_code(dryrun.id('t_hr1')) = 'HEAD_REVIEW',
  '9B-1 pinned stable codes resolve (BLOG, HEAD_REVIEW)');

-- 2. Head Review references exactly its source Blog task.
select dryrun.ok(public.content_os_is_source_blog_for_head_review(dryrun.id('t_blog1'), dryrun.id('t_hr1')), '9B-2 Head Review 1 is the review of Blog 1');
select dryrun.ok(not public.content_os_is_source_blog_for_head_review(dryrun.id('t_blog2'), dryrun.id('t_hr1')), '9B-2 Head Review 1 is NOT a review of Blog 2');
select dryrun.ok(not public.content_os_is_source_blog_for_head_review(dryrun.id('t_blog1'), dryrun.id('t_seo1')), '9B-2 an SEO task with the same source and Blog is not a Head Review');
select dryrun.ok(not public.content_os_is_source_blog_for_head_review(dryrun.id('t_blog1'), dryrun.id('t_hr_mismatch')), '9B-2 a Head Review whose PRIMARY Blog differs from its source''s Blog does not qualify');
select dryrun.ok(not public.content_os_is_source_blog_for_head_review(dryrun.id('t_hr1'), dryrun.id('t_blog1')), '9B-2 the relation is directional (Blog is not the review of Head Review)');

-- 3. Unrelated Content OS DONE tasks cannot qualify.
select dryrun.set_status('t_blog1', 'DONE'); select dryrun.set_status('t_blog2', 'DONE'); select dryrun.set_status('t_research9b', 'DONE');
select dryrun.ok(not public.content_os_revision_allowed(dryrun.id('t_research9b'), dryrun.id('head'), dryrun.id('t_hr1')), '9B-3 a DONE Research task cannot be sent to REVISION via a Head Review');
select dryrun.ok(public.content_os_find_revision_review(dryrun.id('t_research9b'), dryrun.id('head')) is null, '9B-3 no qualifying review for a DONE non-Blog task (even for the Head)');
select dryrun.ok(public.content_os_find_revision_review(dryrun.id('t_blog2'), dryrun.id('head')) is null, '9B-3 a DONE Blog without its own Head Review cannot be sent to REVISION');
select dryrun.ok(public.content_os_find_revision_review(dryrun.id('t_seo1'), dryrun.id('head')) is null, '9B-3 a DONE-able SEO task never qualifies');

-- 4. Wrong reviewer cannot qualify.
select dryrun.ok(not public.content_os_revision_allowed(dryrun.id('t_blog1'), dryrun.id('b_other'), dryrun.id('t_hr1')), '9B-4 an unrelated member cannot request the revision');
select dryrun.ok(not public.content_os_revision_allowed(dryrun.id('t_blog1'), dryrun.id('b_author'), dryrun.id('t_hr1')), '9B-4 the Blog author cannot send their own Blog back');
update public.tasks set assignee_id = dryrun.id('b_inactive') where id = dryrun.id('t_hr1');
select dryrun.ok(not public.content_os_revision_allowed(dryrun.id('t_blog1'), dryrun.id('b_inactive'), dryrun.id('t_hr1')), '9B-4 an inactive Head Review assignee never qualifies');
update public.tasks set assignee_id = dryrun.id('b_reviewer') where id = dryrun.id('t_hr1');

-- 5. The correct Head Review can request the revision.
select dryrun.ok(public.content_os_revision_allowed(dryrun.id('t_blog1'), dryrun.id('b_reviewer'), dryrun.id('t_hr1')), '9B-5 the Head Review assignee may send its source Blog to REVISION');
update public.users set is_active = false where id = dryrun.id('head');
update public.users set is_active = true where telegram_user_id = 2001;
select dryrun.put('b_head', id) from public.users where telegram_user_id = 2001;
select dryrun.ok(public.content_os_revision_allowed(dryrun.id('t_blog1'), dryrun.id('b_head'), dryrun.id('t_hr1')), '9B-5 the active Head of Marketing may also decide');
select dryrun.ok(public.content_os_find_revision_review(dryrun.id('t_blog1'), dryrun.id('b_reviewer')) = dryrun.id('t_hr1'), '9B-5 find_revision_review returns exactly that Head Review');
select dryrun.set_status('t_hr1', 'BLOCKED');
select dryrun.ok(not public.content_os_revision_allowed(dryrun.id('t_blog1'), dryrun.id('b_reviewer'), dryrun.id('t_hr1')), '9B-5 a BLOCKED Head Review cannot decide');
select dryrun.set_status('t_hr1', 'IN_PROGRESS');

-- 6/7. Revision returns the SAME Blog task; resubmission creates no Blog.
create table dryrun.blog_task_count as
  select count(*) as n from public.content_task_runtime r join public.content_task_type_versions v on v.id = r.task_type_version_id where v.task_type_id = dryrun.id('tt_blog');
select dryrun.set_status('t_blog1', 'REVISION');
select dryrun.ok(public.content_os_find_revision_review(dryrun.id('t_blog1'), dryrun.id('b_reviewer')) is null, '9B-6 while the Blog is in REVISION no second revision can be requested');
select dryrun.ok(not public.content_os_completion_allowed(dryrun.id('t_hr1')), '9B-6 the Head Review cannot be completed while its Blog is in REVISION');
select dryrun.ok(public.content_os_completion_allowed(dryrun.id('t_seo1')), '9B-6 completion of non-Head-Review tasks is unaffected');
select dryrun.set_status('t_blog1', 'DONE');
select dryrun.ok(public.content_os_completion_allowed(dryrun.id('t_hr1')), '9B-7 after the corrected Blog is DONE the SAME Head Review can complete');
select dryrun.ok(public.content_os_find_revision_review(dryrun.id('t_blog1'), dryrun.id('b_reviewer')) = dryrun.id('t_hr1'), '9B-7 ...or request another revision of the SAME Blog task');
select dryrun.ok((select count(*) from public.content_task_runtime r join public.content_task_type_versions v on v.id = r.task_type_version_id where v.task_type_id = dryrun.id('tt_blog')) = (select n from dryrun.blog_task_count)
  and (select count(*) from public.content_task_runtime where source_task_id = dryrun.id('t_blog1') and task_type_version_id = dryrun.id('ttv_hr_1')) = 2,
  '9B-7 the round trip created no Blog task and no extra Head Review');
select dryrun.expect_error($$update public.content_task_runtime set source_task_id = (select v from dryrun.ids where k = 't_blog2') where task_id = (select v from dryrun.ids where k = 't_hr1')$$, '55000', '9B-7 the Head Review cannot be re-pointed at another Blog');

-- 8. Pinned config survives newer Task Type versions.
with x as (insert into public.content_task_type_versions (task_type_id, version, name, definition, review_required)
  values (dryrun.id('tt_blog'), 3, 'Blog (review now required)', '{}', true) returning id) select dryrun.put('ttv_blog_3', id) from x;
update public.content_task_types set current_version_id = dryrun.id('ttv_blog_3') where id = dryrun.id('tt_blog');
select dryrun.mk_task_for('t_blog3', 'Blog 3 on v3', 'b_author');
insert into public.content_task_runtime (task_id, task_type_version_id) values (dryrun.id('t_blog3'), dryrun.id('ttv_blog_3'));
select dryrun.ok(public.content_os_requires_review(dryrun.id('t_blog1')) = false, '9B-8 Blog 1 keeps its pinned v1 rule (not review-required) after v3 became current');
select dryrun.ok(public.content_os_requires_review(dryrun.id('t_blog3')) = true, '9B-8 a task created on v3 follows v3');
select dryrun.ok(public.content_os_task_type_code(dryrun.id('t_blog1')) = 'BLOG', '9B-8 pinned task keeps its stable code');

-- 9. Malformed review config fails safely; step override precedence.
with x as (insert into public.content_workflow_template_versions (template_id, version, name, module_type)
  values (dryrun.id('wf'), 3, 'Qoldiq v3 (9B)', 'KNOWLEDGE_DEVELOPMENT') returning id) select dryrun.put('wfv3', id) from x;
with x as (insert into public.content_workflow_steps (template_version_id, step_key, task_type_id, name_template, step_order, overrides) values
  (dryrun.id('wfv3'), 'blog-malformed', dryrun.id('tt_blog'), 'Blog malformed', 0, '{"reviewRequired": "no"}'),
  (dryrun.id('wfv3'), 'blog-null', dryrun.id('tt_blog'), 'Blog null override', 1, '{"reviewRequired": null}'),
  (dryrun.id('wfv3'), 'blog-forced', dryrun.id('tt_blog'), 'Blog forced review', 2, '{"reviewRequired": true}'),
  (dryrun.id('wfv3'), 'hr-waived', dryrun.id('tt_hr'), 'Head Review waived', 3, '{"reviewRequired": false}')
  returning id, step_key) select dryrun.put('s9b_' || step_key, id) from x;
update public.content_workflow_template_versions set status = 'PUBLISHED', published_at = now() where id = dryrun.id('wfv3');
with x as (insert into public.content_workflow_runs (template_version_id, started_by) values (dryrun.id('wfv3'), dryrun.id('b_head')) returning id) select dryrun.put('run9b', id) from x;
create function dryrun.mk_step_task(p_key text, p_version text, p_step text) returns uuid language plpgsql as $$
declare v uuid := dryrun.mk_task_for(p_key, p_key, 'b_author');
begin
  insert into public.content_task_runtime (task_id, task_type_version_id, workflow_run_id, workflow_template_version_id, workflow_step_id)
  values (v, dryrun.id(p_version), dryrun.id('run9b'), dryrun.id('wfv3'), dryrun.id(p_step));
  return v;
end $$;
-- Created in their own statements: the STABLE predicate reads the statement snapshot.
select dryrun.mk_step_task('t_malformed', 'ttv_blog_1', 's9b_blog-malformed');
select dryrun.mk_step_task('t_nulloverride', 'ttv_blog_1', 's9b_blog-null');
select dryrun.mk_step_task('t_forced', 'ttv_blog_1', 's9b_blog-forced');
select dryrun.mk_step_task('t_waived', 'ttv_hr_1', 's9b_hr-waived');
select dryrun.ok(public.content_os_requires_review(dryrun.id('t_malformed')) = true, '9B-9 a non-boolean override fails safe (review required)');
select dryrun.ok(public.content_os_requires_review(dryrun.id('t_nulloverride')) = false, '9B-9 a JSON null override falls back to the pinned version (same as ?? in the runtime)');
select dryrun.ok(public.content_os_requires_review(dryrun.id('t_forced')) = true, '9B-9 a boolean step override wins over the pinned version');
select dryrun.ok(public.content_os_requires_review(dryrun.id('t_waived')) = false, '9B-9 override false waives review');
select dryrun.ok(public.content_os_requires_review(dryrun.id('t_bare')) is null and not public.content_os_is_task(dryrun.id('t_bare')),
  '9B-9 a task without a runtime row is not a Content OS task (requires_review is null)');
select dryrun.expect_error($$update public.content_workflow_steps set overrides = '{"reviewRequired": false}' where id = (select v from dryrun.ids where k = 's9b_blog-malformed')$$, '55000', '9B-9 published step config cannot be patched afterwards');

-- Function hygiene + grants.
select dryrun.ok(not exists (
  select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'content_os_%'
    and (p.prosecdef or not ('search_path=""' = any (coalesce(p.proconfig, '{}'))) or has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or not has_function_privilege('service_role', p.oid, 'EXECUTE'))
), '9B every content_os_* function: SECURITY INVOKER, search_path pinned, EXECUTE for service_role only');
set role service_role;
select dryrun.ok(public.content_os_revision_allowed(dryrun.id('t_blog1'), dryrun.id('b_reviewer'), dryrun.id('t_hr1')), '9B predicates work as service_role (the Task Bot caller)');
reset role;
update public.users set is_active = false where id = dryrun.id('b_head');
update public.users set is_active = true where id = dryrun.id('head');

\echo 'ALL TRANSITION CONTRACT TESTS PASSED'
