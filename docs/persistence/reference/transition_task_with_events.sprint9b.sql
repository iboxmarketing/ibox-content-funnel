-- REFERENCE ONLY — owned by marketing-team-task-bot (Codex). NOT a Content OS
-- migration, never applied by Content OS. Complete reference body for the
-- Task Bot A2/A3 migration implementing docs/persistence/SPRINT_9_TRANSITION_CONTRACT.md §3,
-- derived from Sprint 9A 20261014120200_content_os_task_transition_compatibility.sql
-- (199581f): legacy matrix, events, revisions, checklist rule unchanged; the
-- Content OS branch now calls the Content OS-owned predicates and the broad
-- "DONE -> REVISION for any Content OS task by creator/Head" rule is gone.
-- Proven by supabase/content-os-drafts/dry-run/40_reference_transition_tests.sql.

create or replace function public.transition_task_with_events(
  p_task_id uuid,
  p_actor_id uuid,
  p_new_status text,
  p_reason text default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_old_status text;
  v_special_event text;
  v_actor public.users;
  v_allowed boolean;
  v_review_task_id uuid;
begin
  select * into v_actor from public.users where id = p_actor_id and is_active;
  if not found then
    raise exception 'actor is not active' using errcode = '42501';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'task not found' using errcode = 'P0002'; end if;
  v_old_status := v_task.status;
  if v_old_status = p_new_status then return v_task; end if;

  -- Unchanged legacy transition matrix (every task).
  v_allowed :=
    (v_old_status = 'ASSIGNED' and p_new_status in ('IN_PROGRESS', 'CANCELLED'))
    or (v_old_status = 'IN_PROGRESS' and p_new_status in ('BLOCKED', 'REVIEW', 'CANCELLED'))
    or (v_old_status = 'BLOCKED' and p_new_status in ('IN_PROGRESS', 'CANCELLED'))
    or (v_old_status = 'REVIEW' and p_new_status in ('DONE', 'REVISION', 'CANCELLED'))
    or (v_old_status = 'REVISION' and p_new_status in ('IN_PROGRESS', 'BLOCKED', 'REVIEW', 'CANCELLED'))
    or (v_old_status in ('DONE', 'CANCELLED') and p_new_status = 'ASSIGNED');

  -- Content OS compatibility (Sprint 9B contract): consulted only for the
  -- three extra transitions. The outer IF only tests to_regprocedure, so no
  -- Content OS function is planned or called when the Content OS schema is
  -- absent (legacy behaviour, also after a Content OS rollback).
  if not v_allowed
    and ((v_old_status in ('IN_PROGRESS', 'REVISION') and p_new_status = 'DONE')
      or (v_old_status = 'DONE' and p_new_status = 'REVISION'))
    and to_regprocedure('public.content_os_find_revision_review(uuid, uuid)') is not null then
    if public.content_os_is_task(p_task_id) then
      if p_new_status = 'DONE' then
        if public.content_os_requires_review(p_task_id) then
          raise exception 'task status changed concurrently' using errcode = '40001';
        end if;
        if v_task.assignee_id <> p_actor_id then
          raise exception 'only the assignee may complete this Content OS task' using errcode = '42501';
        end if;
        if not public.content_os_completion_allowed(p_task_id) then
          raise exception 'task status changed concurrently' using errcode = '40001';
        end if;
        if exists (
          select 1 from public.task_checklists c
          join public.task_checklist_items i on i.checklist_id = c.id
          where c.task_id = p_task_id and not i.is_completed
        ) then raise exception 'posting checklist is incomplete' using errcode = '23514'; end if;
        v_allowed := true;
      else
        v_review_task_id := public.content_os_find_revision_review(p_task_id, p_actor_id);
        if v_review_task_id is null then
          raise exception 'only the source Blog''s Head Review may request this revision' using errcode = '42501';
        end if;
        v_allowed := true;
      end if;
    end if;
  end if;

  if not v_allowed then raise exception 'task status changed concurrently' using errcode = '40001'; end if;
  if p_new_status = 'BLOCKED' and nullif(btrim(p_reason), '') is null then
    raise exception 'blocked reason is required' using errcode = '22023';
  end if;
  if p_new_status = 'REVIEW' and exists (
    select 1 from public.task_checklists c
    join public.task_checklist_items i on i.checklist_id = c.id
    where c.task_id = p_task_id and not i.is_completed
  ) then raise exception 'posting checklist is incomplete' using errcode = '23514'; end if;

  update public.tasks set
    status = p_new_status,
    blocked_reason = case when p_new_status = 'BLOCKED' then btrim(p_reason) else null end,
    completed_at = case when p_new_status = 'DONE' then statement_timestamp() else null end,
    cancelled_at = case when p_new_status = 'CANCELLED' then statement_timestamp() else null end
  where id = p_task_id returning * into v_task;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (p_task_id, p_actor_id, 'STATUS_CHANGED', to_jsonb(v_old_status), to_jsonb(p_new_status),
    case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end
      || case when v_review_task_id is null then '{}'::jsonb else jsonb_build_object('reviewTaskId', v_review_task_id) end);
  v_special_event := case
    when v_old_status = 'ASSIGNED' and p_new_status = 'IN_PROGRESS' then 'TASK_ACCEPTED'
    when p_new_status = 'BLOCKED' then 'TASK_BLOCKED'
    when v_old_status = 'BLOCKED' then 'TASK_UNBLOCKED'
    when p_new_status = 'REVIEW' then 'REVIEW_REQUESTED'
    when p_new_status = 'REVISION' then 'REVISION_REQUESTED'
    when p_new_status = 'DONE' then 'TASK_COMPLETED'
    when p_new_status = 'CANCELLED' then 'TASK_CANCELLED'
    when v_old_status in ('DONE', 'CANCELLED') then 'TASK_REOPENED'
    else null end;
  if v_special_event is not null then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (p_task_id, p_actor_id, v_special_event, to_jsonb(v_old_status), to_jsonb(p_new_status),
      case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end
      || case when v_review_task_id is null then '{}'::jsonb else jsonb_build_object('reviewTaskId', v_review_task_id) end);
  end if;
  if p_new_status = 'REVISION' then
    insert into public.task_revisions (task_id, requested_by, reason)
    values (p_task_id, p_actor_id, nullif(btrim(p_reason), ''));
  end if;
  return v_task;
end;
$$;

comment on function public.transition_task_with_events(uuid, uuid, text, text) is
  'Task lifecycle transition with audit events. Legacy matrix for every task; for Content OS tasks only (content_os_* predicates, Sprint 9B contract): IN_PROGRESS/REVISION -> DONE for non-review-required tasks by the assignee, DONE -> REVISION of a source Blog only via its open Head Review (assignee or Head).';
