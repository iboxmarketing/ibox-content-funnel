-- LOCAL E2E ONLY. PostgREST login role + deterministic fixtures.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'e2e-local-only';
  end if;
end $$;
grant anon, service_role to authenticator;

insert into public.users (id, telegram_user_id, display_name, role, is_active) values
  ('00000000-0000-4000-8000-00000000e001', 9001, 'Head', 'HEAD_OF_MARKETING', true),
  ('00000000-0000-4000-8000-00000000e002', 9002, 'Author', 'CONTENT_MARKETER', true),
  ('00000000-0000-4000-8000-00000000e003', 9003, 'Reviewer', 'DIGITAL_MARKETER', true),
  ('00000000-0000-4000-8000-00000000e004', 9004, 'Other', 'SMM_MANAGER', true),
  ('00000000-0000-4000-8000-00000000e005', 9005, 'Former', 'SMM_MANAGER', false);

-- Tenant "site-e2e". One link per scenario; revoked / wrong-tenant / inactive-user rows exist on purpose.
insert into public.external_identity_links (provider, tenant_key, external_subject, user_id, linked_by) values
  ('OPENAI_SIWC', 'site-e2e', 'siwc-head', '00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000e001'),
  ('OPENAI_SIWC', 'site-e2e', 'siwc-author', '00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000e001'),
  ('OPENAI_SIWC', 'site-e2e', 'siwc-reviewer', '00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000e001'),
  ('OPENAI_SIWC', 'site-other', 'siwc-other-tenant', '00000000-0000-4000-8000-00000000e004', '00000000-0000-4000-8000-00000000e001'),
  ('OPENAI_SIWC', 'site-e2e', 'siwc-former', '00000000-0000-4000-8000-00000000e005', '00000000-0000-4000-8000-00000000e001'),
  ('OPENAI_SIWC', 'site-e2e', 'siwc/odd,subject (x)&y=z', '00000000-0000-4000-8000-00000000e004', '00000000-0000-4000-8000-00000000e001');
insert into public.external_identity_links (provider, tenant_key, external_subject, user_id, linked_by, status, revoked_by, revoked_at, revoke_reason) values
  ('OPENAI_SIWC', 'site-e2e', 'siwc-revoked', '00000000-0000-4000-8000-00000000e004', '00000000-0000-4000-8000-00000000e001', 'REVOKED', '00000000-0000-4000-8000-00000000e001', now(), 'left the team');

insert into public.content_domains (id, name) values ('00000000-0000-4000-8000-0000000c0001', 'Ombor');
insert into public.content_problem_categories (id, domain_id, name) values ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-0000000c0001', 'Qoldiq');
insert into public.content_problem_parts (id, problem_category_id, name) values ('00000000-0000-4000-8000-0000000c0003', '00000000-0000-4000-8000-0000000c0002', 'Hisobda kam');
insert into public.content_knowledge_nodes (id, problem_part_id, name) values ('00000000-0000-4000-8000-0000000c0004', '00000000-0000-4000-8000-0000000c0003', 'Qaytgan tovar');
do $$
declare t uuid; v uuid; c text;
begin
  foreach c in array array['BLOG', 'HEAD_REVIEW'] loop
    insert into public.content_task_types (code) values (c) returning id into t;
    insert into public.content_task_type_versions (task_type_id, version, name, definition, review_required) values (t, 1, c, '{}', false) returning id into v;
    update public.content_task_types set current_version_id = v where id = t;
  end loop;
end $$;
