-- LOCAL DRY-RUN ONLY. Contract tests for the Content OS drafts, executed on a
-- disposable PostgreSQL 17 database built from the task-bot repo migrations.
-- Every check prints `PASS <label>` or aborts the run (ON_ERROR_STOP).

create schema dryrun;

create function dryrun.expect_error(p_sql text, p_sqlstate text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_sqlstate then
      raise notice 'PASS % (% %)', p_label, sqlstate, sqlerrm;
      return;
    end if;
    raise exception 'FAIL % : expected %, got % (%)', p_label, p_sqlstate, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL % : expected error %, but the statement succeeded', p_label, p_sqlstate;
end $$;

-- Same, but the error message must also name the expected constraint/cause,
-- so a check cannot pass because a DIFFERENT rule happened to fire.
create function dryrun.expect_error_like(p_sql text, p_sqlstate text, p_message_like text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_sqlstate and sqlerrm like p_message_like then
      raise notice 'PASS % (% %)', p_label, sqlstate, sqlerrm;
      return;
    end if;
    raise exception 'FAIL % : expected % like "%", got % (%)', p_label, p_sqlstate, p_message_like, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL % : expected error %, but the statement succeeded', p_label, p_sqlstate;
end $$;

create function dryrun.ok(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition is not true then raise exception 'FAIL %', p_label; end if;
  raise notice 'PASS %', p_label;
end $$;

create table dryrun.ids (k text primary key, v uuid not null);
create function dryrun.id(p_k text) returns uuid language sql stable as $$ select v from dryrun.ids where k = p_k $$;
create function dryrun.put(p_k text, p_v uuid) returns uuid language sql as $$ insert into dryrun.ids values (p_k, p_v) returning v $$;

-- Seed: real users, real tasks through the EXISTING creation RPC ------------
insert into public.users (telegram_user_id, display_name, role, is_active) values
  (1001, 'Head', 'HEAD_OF_MARKETING', true),
  (1002, 'Content Marketer', 'CONTENT_MARKETER', true),
  (1003, 'Operator', 'OPERATOR_VIDEO_EDITOR', true),
  (1004, 'Former member', 'SMM_MANAGER', false);
select dryrun.put('head', id) from public.users where telegram_user_id = 1001;
select dryrun.put('cm', id) from public.users where telegram_user_id = 1002;
select dryrun.put('op', id) from public.users where telegram_user_id = 1003;
select dryrun.put('inactive', id) from public.users where telegram_user_id = 1004;

create function dryrun.mk_task(p_key text, p_title text) returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from public.create_task_with_event_v2(dryrun.id('head'), dryrun.id('cm'), p_title, '', 'normal', now() + interval '3 days');
  return dryrun.put(p_key, v);
end $$;

select dryrun.mk_task(k, t) from (values
  ('t_research', 'Research'), ('t_blog', 'Blog'), ('t_hr', 'Head Review'), ('t_seo', 'SEO'),
  ('t_shoot', 'Shoot'), ('t_edit_a', 'Edit A'), ('t_cover_a', 'Cover A'), ('t_caption_a', 'Caption A'),
  ('t_pub_ig', 'Publish IG'), ('t_pub_tg', 'Publish TG'), ('t_check_ig', 'Publish Check IG'), ('t_learning', 'Learning A')
) v(k, t);

-- T01/T02: task-bot objects untouched -----------------------------------------
select dryrun.ok(not exists (
  select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'content_ref'
), 'T02 no tasks.content_ref column');
select dryrun.ok(not exists (
  select 1 from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name in ('users', 'tasks', 'task_events', 'deadline_change_requests', 'reassign_requests', 'task_revisions',
      'recurring_definitions', 'task_checklists', 'task_checklist_items', 'report_deliveries', 'user_events', 'task_reminder_deliveries')
    and c.column_name like 'content%'
), 'T02 no content_* column added to any task-bot table');

-- Content entities ----------------------------------------------------------
with x as (insert into public.content_domains (name, legacy_ref, legacy_source) values ('Ombor', 'ombor', 'AREA') returning id) select dryrun.put('dom', id) from x;
with x as (insert into public.content_problem_categories (domain_id, name, legacy_ref, legacy_source)
  values (dryrun.id('dom'), 'Qoldiq noto''g''ri', 'CP-070', '11_CANONICAL_MUAMMOLAR') returning id) select dryrun.put('cat', id) from x;
with x as (insert into public.content_problem_parts (problem_category_id, name)
  values (dryrun.id('cat'), 'Hisobda kam → Omborda ko''p') returning id) select dryrun.put('part', id) from x;
with x as (insert into public.content_knowledge_nodes (problem_part_id, name, legacy_ref) values (dryrun.id('part'), 'Qaytgan tovar', 'ND-031-01') returning id) select dryrun.put('node1', id) from x;
with x as (insert into public.content_knowledge_nodes (problem_part_id, name) values (dryrun.id('part'), 'Inventarizatsiya xatosi') returning id) select dryrun.put('node2', id) from x;
with x as (insert into public.content_blogs (knowledge_node_id, title, source_task_id)
  values (dryrun.id('node1'), 'Qaytgan tovar — blog', dryrun.id('t_research')) returning id) select dryrun.put('blog', id) from x;
with x as (insert into public.content_angles (knowledge_node_id, title, usage, priority) values (dryrun.id('node1'), 'Muzlagan pul', 'ORGANIC', 'NOW') returning id) select dryrun.put('angle1', id) from x;
with x as (insert into public.content_destinations (problem_category_id, name, type, status)
  values (dryrun.id('cat'), 'Qoldiq audit checklist', 'CHECKLIST_OR_PDF', 'IN_PROGRESS') returning id) select dryrun.put('dest', id) from x;
insert into public.content_angle_destination_links (angle_id, destination_id) values (dryrun.id('angle1'), dryrun.id('dest'));
with x as (insert into public.content_repurpose_maps (blog_id) values (dryrun.id('blog')) returning id) select dryrun.put('rmap', id) from x;
with x as (insert into public.content_atomic_ideas (repurpose_map_id, position, text, coverage_type, decision, selected_formats, angle_id, destination_needed)
  values (dryrun.id('rmap'), 0, 'Qaytgan tovar hisobga kiritilmasa', 'PROBLEM', 'CREATE_CONTENT', array['REEL', 'CAROUSEL'], dryrun.id('angle1'), true) returning id) select dryrun.put('idea1', id) from x;
with x as (insert into public.content_atomic_ideas (repurpose_map_id, position, text, coverage_type, decision, selected_formats)
  values (dryrun.id('rmap'), 1, 'Oqibat: muzlagan pul', 'CONSEQUENCE', 'CREATE_CONTENT', array['TEXT_POST']) returning id) select dryrun.put('idea2', id) from x;
with x as (insert into public.content_shoot_sessions (title, scheduled_on) values ('Seshanba Shoot', date '2026-10-27') returning id) select dryrun.put('session', id) from x;
with x as (insert into public.content_materials (blog_id, title, format, primary_atomic_idea_id, angle_id, destination_needed, destination_id, cta_type, cta_text, shoot_session_id)
  values (dryrun.id('blog'), 'Reel A', 'REEL', dryrun.id('idea1'), dryrun.id('angle1'), true, dryrun.id('dest'), 'RESOURCE', 'Checklistni oling', dryrun.id('session')) returning id) select dryrun.put('reel_a', id) from x;
with x as (insert into public.content_materials (blog_id, title, format, primary_atomic_idea_id)
  values (dryrun.id('blog'), 'Carousel A', 'CAROUSEL', dryrun.id('idea1')) returning id) select dryrun.put('carousel_a', id) from x;
with x as (insert into public.content_materials (blog_id, title, format, primary_atomic_idea_id, cta_type, cta_text)
  values (dryrun.id('blog'), 'Text A', 'TEXT_POST', dryrun.id('idea2'), 'FOLLOW', 'Obuna bo''ling') returning id) select dryrun.put('text_a', id) from x;

select dryrun.ok((select count(*) from public.content_materials where primary_atomic_idea_id = dryrun.id('idea1')) = 2,
  'T05 one Atomic Idea generates multiple Materials (one per format)');
select dryrun.ok((select destination_id is null from public.content_materials where id = dryrun.id('text_a')),
  'T04 Material without Destination is allowed (destination_id NULL)');
select dryrun.ok((select count(*) from public.content_materials where shoot_session_id = dryrun.id('session')) = 1,
  'T08 ShootSession membership is stored once (content_materials.shoot_session_id)');

-- T03: exact enum CHECKs ------------------------------------------------------
select dryrun.expect_error($$insert into public.content_materials (blog_id, title, format) values ((select v from dryrun.ids where k = 'blog'), 'x', 'PODCAST')$$, '23514', 'T03 material format CHECK');
select dryrun.expect_error($$insert into public.content_blogs (knowledge_node_id, title, state) values ((select v from dryrun.ids where k = 'node1'), 'x', 'ARCHIVED')$$, '23514', 'T03 blog state CHECK');
select dryrun.expect_error($$insert into public.content_atomic_ideas (repurpose_map_id, position, text, coverage_type, decision, selected_formats) values ((select v from dryrun.ids where k = 'rmap'), 9, 'x', 'PROBLEM', 'CREATE_CONTENT', array['PODCAST'])$$, '23514', 'T03 atomic idea formats ⊆ material formats');
select dryrun.expect_error($$insert into public.content_destinations (problem_category_id, name, type) values ((select v from dryrun.ids where k = 'cat'), 'x', 'WEBINAR')$$, '23514', 'T03 destination type CHECK');
select dryrun.expect_error($$insert into public.content_materials (blog_id, title, format, cta_type) values ((select v from dryrun.ids where k = 'blog'), 'x', 'REEL', 'FOLLOW')$$, '23514', 'T04 CTA type and text are set together');
select dryrun.expect_error($$insert into public.content_materials (blog_id, title, format, primary_atomic_idea_id) values ((select v from dryrun.ids where k = 'blog'), 'Reel dup', 'REEL', (select v from dryrun.ids where k = 'idea1'))$$, '23505', 'T05 one Material per (idea, format)');
select dryrun.expect_error($$insert into public.content_problem_categories (domain_id, name, legacy_ref) values ((select v from dryrun.ids where k = 'dom'), 'dup', 'CP-070')$$, '23505', 'T11 legacy stable ref is unique (CP-070)');

-- T07: content_task_links ----------------------------------------------------
insert into public.content_task_links (task_id, entity_type, entity_id, relation) values
  (dryrun.id('t_research'), 'PROBLEM_PART', dryrun.id('part'), 'PRIMARY'),
  (dryrun.id('t_research'), 'KNOWLEDGE_NODE', dryrun.id('node1'), 'RELATED'),
  (dryrun.id('t_research'), 'KNOWLEDGE_NODE', dryrun.id('node2'), 'RELATED'),
  (dryrun.id('t_blog'), 'KNOWLEDGE_NODE', dryrun.id('node1'), 'PRIMARY'),
  (dryrun.id('t_hr'), 'KNOWLEDGE_NODE', dryrun.id('node1'), 'PRIMARY'),
  (dryrun.id('t_seo'), 'KNOWLEDGE_NODE', dryrun.id('node1'), 'PRIMARY'),
  (dryrun.id('t_shoot'), 'SHOOT_SESSION', dryrun.id('session'), 'PRIMARY'),
  (dryrun.id('t_shoot'), 'MATERIAL', dryrun.id('reel_a'), 'RELATED'),
  (dryrun.id('t_edit_a'), 'MATERIAL', dryrun.id('reel_a'), 'PRIMARY'),
  (dryrun.id('t_cover_a'), 'MATERIAL', dryrun.id('reel_a'), 'PRIMARY'),
  (dryrun.id('t_caption_a'), 'MATERIAL', dryrun.id('reel_a'), 'PRIMARY'),
  (dryrun.id('t_pub_ig'), 'MATERIAL', dryrun.id('reel_a'), 'PRIMARY'),
  (dryrun.id('t_pub_tg'), 'MATERIAL', dryrun.id('reel_a'), 'PRIMARY'),
  (dryrun.id('t_check_ig'), 'MATERIAL', dryrun.id('reel_a'), 'PRIMARY'),
  (dryrun.id('t_learning'), 'MATERIAL', dryrun.id('reel_a'), 'PRIMARY');

select dryrun.ok((select count(*) from public.content_task_links where task_id = dryrun.id('t_research')) = 3,
  'T07 one Research task relates to a part (PRIMARY) and many KnowledgeNodes (RELATED)');
select dryrun.ok((select count(*) from public.content_task_links where entity_type = 'MATERIAL' and entity_id = dryrun.id('reel_a')) = 8,
  'T07 reverse lookup: one Material has many tasks (incl. the shared Shoot)');
select dryrun.ok((select count(*) from public.content_task_links where entity_type = 'KNOWLEDGE_NODE' and entity_id = dryrun.id('node1')) = 4,
  'T07 one entity shared by several tasks');
select dryrun.expect_error($$insert into public.content_task_links values ((select v from dryrun.ids where k = 't_research'), 'BLOG', (select v from dryrun.ids where k = 'blog'), 'PRIMARY')$$, '23505', 'T07 at most one PRIMARY entity per task');
select dryrun.expect_error($$insert into public.content_task_links values ((select v from dryrun.ids where k = 't_research'), 'KNOWLEDGE_NODE', (select v from dryrun.ids where k = 'node1'), 'RELATED')$$, '23505', 'T07 idempotent uniqueness (same link twice)');
select dryrun.expect_error($$insert into public.content_task_links values ((select v from dryrun.ids where k = 't_seo'), 'MATERIAL', gen_random_uuid(), 'RELATED')$$, '23503', 'T07 polymorphic entity_id must exist');
select dryrun.expect_error_like($$insert into public.content_task_links values ((select v from dryrun.ids where k = 't_seo'), 'MATERIAL', (select v from dryrun.ids where k = 'blog'), 'RELATED')$$, '23503', 'content entity MATERIAL:% does not exist', 'T07 entity_id must exist in the table of its entity_type (a Blog id is not a Material)');
select dryrun.expect_error($$insert into public.content_task_links values (gen_random_uuid(), 'BLOG', (select v from dryrun.ids where k = 'blog'), 'RELATED')$$, '23503', 'T07 FK to existing public.tasks.id');
select dryrun.expect_error($$update public.content_task_links set relation = 'RELATED' where task_id = (select v from dryrun.ids where k = 't_blog')$$, '55000', 'T07 links are insert-only');

-- T06: FK RESTRICT behavior --------------------------------------------------
-- A bare task row with no task_events (local fixture only), so the ONLY thing
-- that can block its deletion is the Content OS FK.
with x as (insert into public.tasks (title, creator_id, assignee_id, deadline) values ('Bare task', dryrun.id('head'), dryrun.id('cm'), now()) returning id)
select dryrun.put('t_bare', id) from x;
insert into public.content_task_links values (dryrun.id('t_bare'), 'BLOG', dryrun.id('blog'), 'PRIMARY');
select dryrun.expect_error_like($$delete from public.tasks where id = (select v from dryrun.ids where k = 't_bare')$$, '23503', '%content_task_links_task_id_fkey%', 'T06 content_task_links FK RESTRICT protects the operational task');
select dryrun.expect_error_like($$delete from public.content_blogs where id = (select v from dryrun.ids where k = 'blog')$$, '23503', '%content_blogs%', 'T06 a Blog with dependents (Materials / Repurpose Maps) cannot be deleted');
select dryrun.expect_error_like($$delete from public.content_destinations where id = (select v from dryrun.ids where k = 'dest')$$, '23503', '%content_destinations%', 'T06 a Destination used by a Material / Angle link cannot be deleted');

-- Config versioning ----------------------------------------------------------
with x as (insert into public.content_task_types (code) values ('BLOG') returning id) select dryrun.put('tt_blog', id) from x;
with x as (insert into public.content_task_types (code, legacy_ref) values ('HEAD_REVIEW', 'TT-06') returning id) select dryrun.put('tt_hr', id) from x;
with x as (insert into public.content_task_types (code) values ('PUBLISH_SCHEDULE') returning id) select dryrun.put('tt_publish', id) from x;
with x as (insert into public.content_task_type_versions (task_type_id, version, name, definition, default_prompt, prompt_version)
  values (dryrun.id('tt_blog'), 1, 'Blog', '{"requiredFields": []}', E'Blog yoz.\n\n---\nINPUT:\n', 'v1') returning id) select dryrun.put('ttv_blog_1', id) from x;
with x as (insert into public.content_task_type_versions (task_type_id, version, name, definition, default_prompt, prompt_version)
  values (dryrun.id('tt_blog'), 2, 'Blog', '{"requiredFields": []}', E'Blog yoz (yangi).\n\n---\nINPUT:\n', 'v2') returning id) select dryrun.put('ttv_blog_2', id) from x;
with x as (insert into public.content_task_type_versions (task_type_id, version, name, definition)
  values (dryrun.id('tt_hr'), 1, 'Head Review', '{"requiredFields": [{"id": "review-decision"}]}') returning id) select dryrun.put('ttv_hr_1', id) from x;
with x as (insert into public.content_task_type_versions (task_type_id, version, name, definition)
  values (dryrun.id('tt_publish'), 1, 'Publish / Schedule', '{}') returning id) select dryrun.put('ttv_pub_1', id) from x;
update public.content_task_types set current_version_id = dryrun.id('ttv_blog_2') where id = dryrun.id('tt_blog');
update public.content_task_types set current_version_id = dryrun.id('ttv_hr_1') where id = dryrun.id('tt_hr');

select dryrun.expect_error($$update public.content_task_type_versions set default_prompt = 'changed' where id = (select v from dryrun.ids where k = 'ttv_blog_1')$$, '55000', 'T11 a Task Type version is immutable (no in-place prompt edit)');
select dryrun.expect_error($$delete from public.content_task_type_versions where id = (select v from dryrun.ids where k = 'ttv_blog_1')$$, '55000', 'T11 a Task Type version cannot be deleted');
select dryrun.expect_error($$update public.content_task_types set current_version_id = (select v from dryrun.ids where k = 'ttv_hr_1') where id = (select v from dryrun.ids where k = 'tt_blog')$$, '23503', 'T11 current version must belong to the same Task Type');
select dryrun.expect_error($$insert into public.content_task_type_versions (task_type_id, version, name, definition, default_prompt) values ((select v from dryrun.ids where k = 'tt_blog'), 3, 'Blog', '{}', 'prompt without version')$$, '23514', 'T11 a prompt requires a prompt_version');
select dryrun.expect_error($$insert into public.content_task_type_versions (task_type_id, version, name, definition) values ((select v from dryrun.ids where k = 'tt_blog'), 2, 'Blog', '{}')$$, '23505', 'T11 (task_type, version) is unique');

with x as (insert into public.content_workflow_templates (code, legacy_ref) values ('QOLDIQ_KNOWLEDGE', 'WF-BLOG') returning id) select dryrun.put('wf', id) from x;
with x as (insert into public.content_workflow_template_versions (template_id, version, name, module_type)
  values (dryrun.id('wf'), 1, 'Qoldiq — boshlang''ich zanjir', 'KNOWLEDGE_DEVELOPMENT') returning id) select dryrun.put('wfv1', id) from x;
with x as (insert into public.content_workflow_steps (template_version_id, step_key, task_type_id, name_template, blocking, step_order)
  values (dryrun.id('wfv1'), 'step-blog', dryrun.id('tt_blog'), 'Blog', true, 0) returning id) select dryrun.put('step_blog', id) from x;
with x as (insert into public.content_workflow_steps (template_version_id, step_key, task_type_id, name_template, blocking, step_order)
  values (dryrun.id('wfv1'), 'step-head-review', dryrun.id('tt_hr'), 'Head Review', true, 1) returning id) select dryrun.put('step_hr', id) from x;
insert into public.content_workflow_step_dependencies values (dryrun.id('wfv1'), dryrun.id('step_hr'), dryrun.id('step_blog'));

select dryrun.expect_error($$insert into public.content_workflow_runs (template_version_id, started_by) values ((select v from dryrun.ids where k = 'wfv1'), (select v from dryrun.ids where k = 'head'))$$, '23514', 'T11 a run cannot use a DRAFT template version');
select dryrun.expect_error($$update public.content_workflow_templates set current_version_id = (select v from dryrun.ids where k = 'wfv1') where id = (select v from dryrun.ids where k = 'wf')$$, '23514', 'T11 current template version must be PUBLISHED');
select dryrun.expect_error($$insert into public.content_workflow_step_dependencies values ((select v from dryrun.ids where k = 'wfv1'), (select v from dryrun.ids where k = 'step_hr'), (select v from dryrun.ids where k = 'step_hr'))$$, '23514', 'T11 a step cannot depend on itself');

update public.content_workflow_template_versions set status = 'PUBLISHED', published_at = now() where id = dryrun.id('wfv1');
update public.content_workflow_templates set current_version_id = dryrun.id('wfv1') where id = dryrun.id('wf');
select dryrun.ok((select current_version_id = dryrun.id('wfv1') from public.content_workflow_templates where id = dryrun.id('wf')), 'T11 PUBLISHED version becomes current');
select dryrun.expect_error($$update public.content_workflow_template_versions set name = 'renamed' where id = (select v from dryrun.ids where k = 'wfv1')$$, '55000', 'T11 a published template version is immutable');
select dryrun.expect_error($$insert into public.content_workflow_steps (template_version_id, step_key, task_type_id, name_template, step_order) values ((select v from dryrun.ids where k = 'wfv1'), 'late', (select v from dryrun.ids where k = 'tt_blog'), 'Late', 9)$$, '55000', 'T11 no step can be added to a published version');
select dryrun.expect_error($$delete from public.content_workflow_step_dependencies where step_id = (select v from dryrun.ids where k = 'step_hr')$$, '55000', 'T11 published dependencies are immutable');

-- v2 draft: a dependency may not cross versions.
with x as (insert into public.content_workflow_template_versions (template_id, version, name, module_type)
  values (dryrun.id('wf'), 2, 'Qoldiq v2', 'KNOWLEDGE_DEVELOPMENT') returning id) select dryrun.put('wfv2', id) from x;
with x as (insert into public.content_workflow_steps (template_version_id, step_key, task_type_id, name_template, step_order)
  values (dryrun.id('wfv2'), 'step-blog', dryrun.id('tt_blog'), 'Blog', 0) returning id) select dryrun.put('step_blog_v2', id) from x;
select dryrun.expect_error($$insert into public.content_workflow_step_dependencies values ((select v from dryrun.ids where k = 'wfv2'), (select v from dryrun.ids where k = 'step_blog_v2'), (select v from dryrun.ids where k = 'step_hr'))$$, '23503', 'T11 dependencies cannot cross template versions');

-- Runtime + lineage ------------------------------------------------------------
with x as (insert into public.content_workflow_runs (template_version_id, root_entity_type, root_entity_id, started_by)
  values (dryrun.id('wfv1'), 'PROBLEM_CATEGORY', dryrun.id('cat'), dryrun.id('head')) returning id) select dryrun.put('run1', id) from x;
select dryrun.expect_error($$insert into public.content_workflow_runs (template_version_id, root_entity_type, root_entity_id, started_by) values ((select v from dryrun.ids where k = 'wfv1'), 'MATERIAL', gen_random_uuid(), (select v from dryrun.ids where k = 'head'))$$, '23503', 'T09 run root entity must exist');

insert into public.content_task_runtime (task_id, task_type_version_id, workflow_run_id, workflow_template_version_id, workflow_step_id, source_task_id, field_values, outcome)
values
  (dryrun.id('t_blog'), dryrun.id('ttv_blog_1'), dryrun.id('run1'), dryrun.id('wfv1'), dryrun.id('step_blog'), dryrun.id('t_research'),
   '{"blog-link": "https://docs.example.com/blog", "blog-title": "Qaytgan tovar"}', 'COMPLETED'),
  (dryrun.id('t_hr'), dryrun.id('ttv_hr_1'), dryrun.id('run1'), dryrun.id('wfv1'), dryrun.id('step_hr'), dryrun.id('t_blog'),
   '{"review-decision": "Revision requested", "review-note": "Kirishni qisqartiring"}', null);
insert into public.content_task_runtime (task_id, task_type_version_id, source_task_id)
select dryrun.id(k), dryrun.id('ttv_pub_1'), dryrun.id('t_shoot') from (values ('t_edit_a'), ('t_cover_a'), ('t_caption_a')) v(k);
insert into public.content_task_runtime (task_id, task_type_version_id, source_task_id, field_values)
values (dryrun.id('t_check_ig'), dryrun.id('ttv_pub_1'), dryrun.id('t_pub_ig'), '{"outcome": "PUBLISHED_SUCCESSFULLY"}');

select dryrun.ok((select task_type_version_id = dryrun.id('ttv_blog_1') from public.content_task_runtime where task_id = dryrun.id('t_blog')),
  'T11 task keeps its pinned Task Type v1 although v2 is current');
select dryrun.ok((select count(*) from public.content_task_runtime where source_task_id = dryrun.id('t_shoot')) = 3,
  'T09 one Shoot -> many Edit/Cover/Caption (concrete task_id lineage)');
select dryrun.ok((select source_task_id = dryrun.id('t_blog') from public.content_task_runtime where task_id = dryrun.id('t_hr')),
  'T09 Head Review -> the SAME Blog task (revision returns to it)');
select dryrun.ok((select source_task_id = dryrun.id('t_pub_ig') from public.content_task_runtime where task_id = dryrun.id('t_check_ig')),
  'T09 Publish -> Publish Check lineage');
select dryrun.expect_error($$insert into public.content_task_runtime (task_id, task_type_version_id, source_task_id) values ((select v from dryrun.ids where k = 't_learning'), (select v from dryrun.ids where k = 'ttv_pub_1'), (select v from dryrun.ids where k = 't_learning'))$$, '23514', 'T09 a task cannot be its own source');
select dryrun.expect_error($$update public.content_task_runtime set source_task_id = (select v from dryrun.ids where k = 't_research') where task_id = (select v from dryrun.ids where k = 't_hr')$$, '55000', 'T09 lineage is write-once (a Head Review cannot be re-pointed to another task)');
select dryrun.expect_error($$update public.content_task_runtime set task_type_version_id = (select v from dryrun.ids where k = 'ttv_blog_2') where task_id = (select v from dryrun.ids where k = 't_blog')$$, '55000', 'T11 a task''s pinned Task Type version is write-once');
select dryrun.expect_error($$update public.content_task_types set code = 'HEAD_REVIEW_X' where id = (select v from dryrun.ids where k = 'tt_hr')$$, '55000', 'T11 a Task Type code is a stable identifier');
update public.content_task_runtime set field_values = field_values || '{"review-note": "edited"}' where task_id = dryrun.id('t_hr');
select dryrun.ok((select field_values ->> 'review-note' = 'edited' from public.content_task_runtime where task_id = dryrun.id('t_hr')), 'T10 non-provenance runtime metadata stays editable');
select dryrun.expect_error($$insert into public.content_task_runtime (task_id, task_type_version_id, outcome) values ((select v from dryrun.ids where k = 't_seo'), (select v from dryrun.ids where k = 'ttv_blog_1'), 'SKIPPED')$$, '23514', 'T10 SKIPPED requires a skip reason');
select dryrun.expect_error($$insert into public.content_task_runtime (task_id, task_type_version_id, field_values) values ((select v from dryrun.ids where k = 't_seo'), (select v from dryrun.ids where k = 'ttv_blog_1'), '[]')$$, '23514', 'T10 field_values must be a JSON object');
select dryrun.expect_error_like($$insert into public.content_task_runtime (task_id, task_type_version_id, workflow_step_id) values ((select v from dryrun.ids where k = 't_seo'), (select v from dryrun.ids where k = 'ttv_blog_1'), (select v from dryrun.ids where k = 'step_blog'))$$, '23514', '%content_task_runtime_step_needs_run_check%', 'T10 a workflow step requires its run');
select dryrun.expect_error_like($$insert into public.content_task_runtime (task_id, task_type_version_id, workflow_run_id) values ((select v from dryrun.ids where k = 't_seo'), (select v from dryrun.ids where k = 'ttv_blog_1'), (select v from dryrun.ids where k = 'run1'))$$, '23514', '%content_task_runtime_run_version_pair_check%', 'T10 a run is always stored with its pinned template version');
select dryrun.expect_error($$insert into public.content_task_runtime (task_id, task_type_version_id, workflow_run_id, workflow_template_version_id, workflow_step_id) values ((select v from dryrun.ids where k = 't_seo'), (select v from dryrun.ids where k = 'ttv_blog_1'), (select v from dryrun.ids where k = 'run1'), (select v from dryrun.ids where k = 'wfv1'), (select v from dryrun.ids where k = 'step_blog_v2'))$$, '23503', 'T10 a step must belong to the run''s pinned template version');
select dryrun.expect_error($$insert into public.content_task_runtime (task_id, task_type_version_id) values (gen_random_uuid(), (select v from dryrun.ids where k = 'ttv_blog_1'))$$, '23503', 'T10 runtime is keyed by an EXISTING public.tasks.id');
insert into public.content_task_runtime (task_id, task_type_version_id, outcome, skip_reason) values (dryrun.id('t_seo'), dryrun.id('ttv_blog_1'), 'SKIPPED', 'SEO bu safar kerak emas');
select dryrun.ok(true, 'T10 SKIPPED with reason is accepted');

-- Named URL links --------------------------------------------------------------
insert into public.content_task_url_links (task_id, position, label, url) values
  (dryrun.id('t_blog'), 0, 'Final', 'https://docs.example.com/blog'),
  (dryrun.id('t_blog'), 1, 'Reference', 'https://example.com/ref');
select dryrun.ok((select string_agg(label, ',' order by position) from public.content_task_url_links where task_id = dryrun.id('t_blog')) = 'Final,Reference', 'T12 named links keep a stable order');
select dryrun.expect_error($$insert into public.content_task_url_links (task_id, position, label, url) values ((select v from dryrun.ids where k = 't_blog'), 2, 'Bad', 'javascript:alert(1)')$$, '23514', 'T12 link URL must be http(s)');
select dryrun.expect_error($$insert into public.content_task_url_links (task_id, position, label, url) values ((select v from dryrun.ids where k = 't_blog'), 1, 'Dup', 'https://example.com')$$, '23505', 'T12 one link per position');

-- Material result review / Learning ------------------------------------------
insert into public.content_material_result_reviews (material_id, result_review_at) values (dryrun.id('reel_a'), '2026-11-20');
insert into public.content_material_result_review_sources (material_id, publish_task_id, confirmed_at) values
  (dryrun.id('reel_a'), dryrun.id('t_pub_tg'), '2026-10-30 10:00'),
  (dryrun.id('reel_a'), dryrun.id('t_check_ig'), '2026-10-31 10:00');
update public.content_material_result_reviews set result_review_at = '2026-11-10' where material_id = dryrun.id('reel_a');
select dryrun.ok((select count(*) from public.content_material_result_review_sources where material_id = dryrun.id('reel_a')) = 2, 'T15 two successful channels feed ONE Material-level review');
select dryrun.expect_error($$insert into public.content_material_result_reviews (material_id) values ((select v from dryrun.ids where k = 'reel_a'))$$, '23505', 'T15 one result review per Material');
select dryrun.expect_error($$insert into public.content_material_result_review_sources (material_id, publish_task_id) values ((select v from dryrun.ids where k = 'reel_a'), (select v from dryrun.ids where k = 't_pub_tg'))$$, '23505', 'T15 a publish task is a source once');
select dryrun.expect_error($$update public.content_material_result_review_sources set confirmed_at = now()$$, '55000', 'T15 review sources are append-only');

-- Idempotency (sequential; concurrency is exercised by the shell harness) ------
create function dryrun.create_idem(p_purpose text, p_key text, p_hash text, p_title text)
returns table (task_id uuid, created boolean) language sql as $$
  select * from public.content_os_create_task_idempotent(p_purpose, p_key, p_hash, dryrun.id('head'), dryrun.id('cm'), p_title, '', 'normal', now() + interval '2 days')
$$;
select dryrun.put('idem1', task_id) from dryrun.create_idem('CREATE_TASK', 'req-0001', repeat('a', 64), 'Idempotent create');
select dryrun.ok((select (task_id = dryrun.id('idem1') and not created) from dryrun.create_idem('CREATE_TASK', 'req-0001', repeat('a', 64), 'Idempotent create')),
  'T13 retry with same key + same request returns the same task (created=false)');
select dryrun.ok((select count(*) from public.tasks where title = 'Idempotent create') = 1, 'T13 retries never duplicate the task');
select dryrun.expect_error($$select * from dryrun.create_idem('CREATE_TASK', 'req-0001', repeat('b', 64), 'Different request')$$, '23505', 'T13 same key + different request conflicts');
select dryrun.ok((select count(*) from public.tasks where title = 'Different request') = 0, 'T13 the conflicting request created nothing');

select dryrun.put('check_task', task_id) from dryrun.create_idem('PUBLISH_CHECK', dryrun.id('t_pub_ig')::text, repeat('c', 64), 'Publish Check — Instagram');
select dryrun.ok((select (task_id = dryrun.id('check_task') and not created) from dryrun.create_idem('PUBLISH_CHECK', dryrun.id('t_pub_ig')::text, repeat('c', 64), 'Publish Check — Instagram')),
  'T13 one Publish Check per scheduled Publish task (reconciler rerun)');
select dryrun.put('learning_task', task_id) from dryrun.create_idem('MATERIAL_LEARNING', dryrun.id('reel_a')::text, repeat('d', 64), 'Learning — Reel A');
select dryrun.ok((select (task_id = dryrun.id('learning_task') and not created) from dryrun.create_idem('MATERIAL_LEARNING', dryrun.id('reel_a')::text, repeat('d', 64), 'Learning — Reel A')),
  'T13 exactly one automatic Learning per Material (reconciler rerun)');
select dryrun.ok((select count(*) from public.task_events e join public.content_os_idempotency_keys k on k.task_id = e.task_id where e.event_type = 'TASK_CREATED') = 3,
  'T13 created through the existing creation path (TASK_CREATED event per task, none for retries)');
select dryrun.expect_error($$select * from dryrun.create_idem('LEGACY_IMPORT', 'x', repeat('e', 64), 'x')$$, '23514', 'T13 unknown purpose rejected');
select dryrun.expect_error($$update public.content_os_idempotency_keys set request_hash = repeat('f', 64)$$, '55000', 'T13 the ledger is insert-only');
select dryrun.expect_error($$select * from public.content_os_create_task_idempotent('CREATE_TASK', 'req-inactive', repeat('a', 64), (select v from dryrun.ids where k = 'head'), (select v from dryrun.ids where k = 'inactive'), 't', '', 'normal', now())$$, '22023', 'T13 existing creation rules still apply (inactive assignee rejected)');
select dryrun.ok(not exists (select 1 from public.content_os_idempotency_keys where idempotency_key = 'req-inactive'), 'T13 a failed create leaves no idempotency claim behind');

-- External identity links ------------------------------------------------------
insert into public.external_identity_links (provider, tenant_key, external_subject, user_id, linked_by, verified_at)
values ('OPENAI_SIWC', 'ibox-workspace', 'user-abc', dryrun.id('cm'), dryrun.id('head'), now());
select dryrun.expect_error($$insert into public.external_identity_links (provider, tenant_key, external_subject, user_id, linked_by) values ('OPENAI_SIWC', 'ibox-workspace', 'user-abc', (select v from dryrun.ids where k = 'op'), (select v from dryrun.ids where k = 'head'))$$, '23505', 'T16 one ACTIVE mapping per provider/tenant/subject');
select dryrun.expect_error($$insert into public.external_identity_links (provider, tenant_key, external_subject, user_id, linked_by) values ('TELEGRAM', 't', 's', (select v from dryrun.ids where k = 'op'), (select v from dryrun.ids where k = 'head'))$$, '23514', 'T16 provider restricted to OPENAI_SIWC');
select dryrun.expect_error($$update public.external_identity_links set user_id = (select v from dryrun.ids where k = 'op') where external_subject = 'user-abc'$$, '55000', 'T16 a mapping cannot be silently rewritten');
select dryrun.expect_error($$update public.external_identity_links set status = 'REVOKED' where external_subject = 'user-abc'$$, '23514', 'T16 revocation requires who/when/why');
update public.external_identity_links set status = 'REVOKED', revoked_by = dryrun.id('head'), revoked_at = now(), revoke_reason = 'Wrong person linked'
where external_subject = 'user-abc';
insert into public.external_identity_links (provider, tenant_key, external_subject, user_id, linked_by)
values ('OPENAI_SIWC', 'ibox-workspace', 'user-abc', dryrun.id('op'), dryrun.id('head'));
select dryrun.ok((select count(*) from public.external_identity_links where external_subject = 'user-abc') = 2, 'T16 history kept: revoked row + new active row');
select dryrun.expect_error($$delete from public.external_identity_links$$, '55000', 'T16 links are never deleted');
insert into public.external_identity_links (provider, tenant_key, external_subject, user_id, linked_by)
values ('OPENAI_SIWC', 'ibox-workspace', 'user-gone', dryrun.id('inactive'), dryrun.id('head'));
select dryrun.ok(not exists (
  select 1 from public.external_identity_links l join public.users u on u.id = l.user_id
  where l.provider = 'OPENAI_SIWC' and l.tenant_key = 'ibox-workspace' and l.external_subject = 'user-gone' and l.status = 'ACTIVE' and u.is_active
), 'T16 a disabled user fails actor resolution');

-- Security: RLS, grants, function hygiene ---------------------------------------
select dryrun.ok((
  select bool_and(c.relrowsecurity) from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and (c.relname like 'content%' or c.relname = 'external_identity_links')
), 'T17 RLS enabled on every new table');
select dryrun.ok(not exists (select 1 from pg_policies where schemaname = 'public' and (tablename like 'content%' or tablename = 'external_identity_links')),
  'T17 no policies (fail-closed for anon/authenticated)');
select dryrun.ok(not exists (
  select 1 from pg_class c cross join (values ('anon'), ('authenticated')) r(role) cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and (c.relname like 'content%' or c.relname = 'external_identity_links')
    and has_table_privilege(r.role, c.oid, p.priv)
), 'T17 anon/authenticated have no table privilege on any new table');
select dryrun.ok(not exists (
  select 1 from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and c.relname in ('content_domains', 'content_problem_categories', 'content_problem_parts', 'content_knowledge_nodes', 'content_blogs',
      'content_angles', 'content_destinations', 'content_materials', 'content_atomic_ideas', 'content_repurpose_maps', 'content_shoot_sessions',
      'content_task_runtime', 'content_task_links', 'content_task_type_versions', 'content_os_idempotency_keys', 'external_identity_links',
      'content_material_result_reviews', 'content_material_result_review_sources')
    and has_table_privilege('service_role', c.oid, 'DELETE')
), 'T17 service_role cannot DELETE content entities, runtime, links, history or identity links');

select dryrun.ok(not exists (
  select 1
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
  cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(priv)
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and (c.relname like 'content_%' or c.relname = 'external_identity_links')
    and has_table_privilege(r.role, c.oid, p.priv)
), 'T17 Supabase default table privileges are stripped from Content OS tables');

select dryrun.ok(not has_function_privilege('anon', 'public.content_os_create_task_idempotent(text, text, text, uuid, uuid, text, text, text, timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.content_os_create_task_idempotent(text, text, text, uuid, uuid, text, text, text, timestamptz)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.content_os_create_task_idempotent(text, text, text, uuid, uuid, text, text, text, timestamptz)', 'EXECUTE'),
  'T17 idempotent create RPC: EXECUTE for service_role only');
select dryrun.ok(not exists (
  select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname like 'content_os%'
    and (p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))
), 'T18 every new function is SECURITY INVOKER with search_path pinned');

grant usage on schema dryrun to anon, authenticated, service_role;
grant execute on all functions in schema dryrun to anon, authenticated, service_role;
grant select on dryrun.ids to anon, authenticated, service_role;
set role anon;
select dryrun.expect_error($$select * from public.content_materials$$, '42501', 'T17 anon is denied');
reset role;
set role authenticated;
select dryrun.expect_error($$select * from public.content_task_runtime$$, '42501', 'T17 authenticated is denied');
reset role;
set role service_role;
insert into public.content_domains (name) values ('Service-role write');
select dryrun.ok((select count(*) from public.content_domains where name = 'Service-role write') = 1, 'T17 service_role (trusted server) can write');
select dryrun.expect_error($$delete from public.content_domains where name = 'Service-role write'$$, '42501', 'T17 service_role cannot hard-delete content');
reset role;

\echo 'ALL CONTRACT TESTS PASSED'
