-- DRAFT ROLLBACK (Sprint 8B) — dry-run only. Drops every Content OS object
-- created by the drafts, in reverse order. Touches no task-bot object.
-- Data written into these tables is lost: export first in any real rollback.

drop table if exists public.external_identity_links;
drop function if exists private.content_os_guard_identity_link();

drop function if exists public.content_os_create_task_idempotent(text, text, text, uuid, uuid, text, text, text, timestamptz);
drop table if exists public.content_os_idempotency_keys;

drop table if exists public.content_task_type_suggestions;
drop table if exists public.content_task_url_links;
drop table if exists public.content_task_links;
drop table if exists public.content_task_runtime;
drop table if exists public.content_workflow_runs;
drop function if exists private.content_os_assert_link_entity_exists();
drop function if exists private.content_os_assert_root_entity_exists();
drop function if exists private.content_os_entity_exists(text, uuid);
drop function if exists private.content_os_guard_run_version();

alter table if exists public.content_task_types drop constraint if exists content_task_types_current_version_fk;
alter table if exists public.content_workflow_templates drop constraint if exists content_workflow_templates_current_version_fk;
drop table if exists public.content_workflow_step_dependencies;
drop table if exists public.content_workflow_steps;
drop table if exists public.content_workflow_template_versions;
drop table if exists public.content_workflow_templates;
drop table if exists public.content_task_type_versions;
drop table if exists public.content_task_types;
drop function if exists private.content_os_guard_template_version();
drop function if exists private.content_os_guard_draft_steps();
drop function if exists private.content_os_guard_current_template_version();

drop table if exists public.content_material_result_review_sources;
drop table if exists public.content_material_result_reviews;
drop table if exists public.content_materials;
drop table if exists public.content_shoot_sessions;
drop table if exists public.content_atomic_ideas;
drop table if exists public.content_repurpose_maps;
drop table if exists public.content_angle_destination_links;
drop table if exists public.content_destinations;
drop table if exists public.content_angles;
drop table if exists public.content_blogs;
drop table if exists public.content_knowledge_nodes;
drop table if exists public.content_problem_parts;
drop table if exists public.content_problem_categories;
drop table if exists public.content_domains;

drop function if exists private.content_os_prevent_mutation();
