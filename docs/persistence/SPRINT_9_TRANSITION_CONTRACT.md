# Sprint 9 — Content OS transition contract (handoff to Task Bot A2/A3)

Status: **DESIGN + LOCAL DRY-RUN ONLY.** Nothing applied to Supabase,
nothing pushed or deployed. Content OS branch `sprint-9b/persistence-bridge`
(from `ae4873d`). Task Bot implementation being finished by Codex: A2/A3 in
`marketing-team-task-bot-sprint9a` (`199581f`) — this document says exactly
what to change there. Content OS did not modify the Task Bot repo.

Product rules (approved, unchanged): Blog is **not** review-required; when a
Blog completes, one separate **Head Review** task opens; the Head Review may
send **that same** Blog back (`DONE → REVISION`); the author fixes it
(`REVISION → DONE`); the **same** Head Review is reused. No new statuses.

---

## 1. Was the existing schema enough?

**The columns were; their integrity was not.** Everything needed to prove
the relation already exists in the Sprint 8 drafts:

| Fact | Persisted by |
|---|---|
| a task is a Content OS task | a row in `content_task_runtime` (PK `task_id` → `public.tasks.id`) |
| what kind of task it is | `content_task_runtime.task_type_version_id` (pinned) → `content_task_type_versions.task_type_id` → `content_task_types.code` (`BLOG`, `HEAD_REVIEW`) |
| which Blog task a Head Review reviews | `content_task_runtime.source_task_id` (concrete task → task lineage) |
| which Blog entity both tasks are about | `content_task_links` PRIMARY row with `entity_type = 'BLOG'` (insert-only) |
| review-required | pinned `content_task_type_versions.review_required` + pinned `content_workflow_steps.overrides` |
| who may decide | `public.tasks.assignee_id` of the Head Review task, `public.users.role/is_active` |

But `service_role` could UPDATE `content_task_runtime.source_task_id` /
`task_type_version_id` / workflow ids and `content_task_types.code`, so a
proof could be rewritten after the fact (e.g. re-point a Head Review at
another task, or rename a code). **Smallest addition — draft migration
`20261014130000_content_os_06_transition_contract.sql`:**

1. `content_task_runtime_provenance_immutable` trigger: `task_id`,
   `task_type_version_id`, `source_task_id`, `workflow_run_id`,
   `workflow_template_version_id`, `workflow_step_id` are write-once
   (`55000`). Field values / outcome stay editable.
2. `content_task_types_code_immutable` trigger: `code` is write-once.
3. Content OS-owned predicate functions (below), so the Task Bot calls one
   function instead of embedding Content OS semantics or codes.

No new table, no new column, no change to any Task Bot table.

**Mapping rule (persistence bridge, not schema):** a Blog task's PRIMARY
link is the **BLOG entity** it writes (RELATED: its KNOWLEDGE_NODE). The
Head Review's PRIMARY link is the **same BLOG entity** (RELATED: the node).
The local session runtime links both to the Knowledge Node only — that
cannot separate Head Review from SEO/Angle/Performance Consultation, which
share the same source Blog task and node.

## 2. Predicates (exact SQL in migration 06)

All: `language sql`, `stable`, `security invoker`, `set search_path = ''`,
EXECUTE to `service_role` only. They read Task Bot tables `public.tasks` /
`public.users`, which `service_role` can already SELECT.

### `is_content_os_task(task_id)` → `public.content_os_is_task(uuid) boolean`

```sql
select exists (select 1 from public.content_task_runtime where task_id = p_task_id);
```

### `requires_review(task_id)` → `public.content_os_requires_review(uuid) boolean`

Null for a non-Content OS task. Uses the task's **pinned** version and
**pinned** workflow step, never today's current version:

```sql
select case
  when s.overrides is null or not (s.overrides ? 'reviewRequired')
       or jsonb_typeof(s.overrides -> 'reviewRequired') = 'null' then v.review_required
  when jsonb_typeof(s.overrides -> 'reviewRequired') = 'boolean' then (s.overrides -> 'reviewRequired')::boolean
  else true                                             -- malformed: fail safe (must go through REVIEW)
end
from public.content_task_runtime r
join public.content_task_type_versions v on v.id = r.task_type_version_id
left join public.content_workflow_steps s on s.id = r.workflow_step_id
where r.task_id = p_task_id;
```

Why this is the authoritative rule: the Content OS runtime decides it in
`lib/task-completion.ts` `isReviewRequiredFor` → `lib/workflow-template.ts`
`effectiveReviewRequired(taskType.reviewRequired, step)` =
`step.overrides?.reviewRequired ?? taskTypeDefault` (`??` ⇒ absent or null
falls back). Persistence pins both inputs: versions are immutable, published
steps are frozen, and the runtime's pointers are now write-once. (The local
session runtime reads the live Task Type because it has no persistence; the
persisted rule is deliberately the pinned one.) Fail-safe direction: a
malformed override makes the task review-required, which can only remove
the direct-DONE shortcut, never add a transition.

Sprint 9A's inline A2/A3 computation is equivalent (same precedence, same
fail-safe); calling this function removes the duplication.

### `is_source_blog_for_head_review(target_task_id, review_task_id)` → `public.content_os_is_source_blog_for_head_review(uuid, uuid) boolean`

```sql
select exists (
  select 1
  from public.content_task_runtime review
  join public.content_task_type_versions review_version on review_version.id = review.task_type_version_id
  join public.content_task_types review_type on review_type.id = review_version.task_type_id
  join public.content_task_runtime target on target.task_id = review.source_task_id
  join public.content_task_type_versions target_version on target_version.id = target.task_type_version_id
  join public.content_task_types target_type on target_type.id = target_version.task_type_id
  join public.content_task_links target_link
    on target_link.task_id = target.task_id and target_link.relation = 'PRIMARY' and target_link.entity_type = 'BLOG'
  join public.content_task_links review_link
    on review_link.task_id = review.task_id and review_link.relation = 'PRIMARY' and review_link.entity_type = 'BLOG'
   and review_link.entity_id = target_link.entity_id
  where review.task_id = p_review_task_id and target.task_id = p_target_task_id
    and review_type.code = 'HEAD_REVIEW' and target_type.code = 'BLOG'
);
```

Five independent conditions, all on stable ids/codes: review is a
`HEAD_REVIEW` (pinned), target is a `BLOG` (pinned), the review's concrete
`source_task_id` **is** the target, and both PRIMARY links point at the
**same** Blog entity. SEO/Angle/PC tasks share the source and node but fail
the code check; a Head Review of another Blog fails the source check.

### `revision_allowed(target_task_id, actor_id, review_task_id)` → `public.content_os_revision_allowed(uuid, uuid, uuid) boolean`

```sql
select public.content_os_is_source_blog_for_head_review(p_target_task_id, p_review_task_id)
  and exists (select 1 from public.tasks where id = p_target_task_id and status = 'DONE')
  and exists (
    select 1
    from public.tasks review_task
    join public.users actor on actor.id = p_actor_id and actor.is_active
    where review_task.id = p_review_task_id
      and review_task.status = 'IN_PROGRESS'
      and (review_task.assignee_id = actor.id or actor.role = 'HEAD_OF_MARKETING')
  );
```

Reviewer authorization: the **active** actor is the Head Review task's
**assignee** (the person who owns that decision) **or** the active Head of
Marketing (super admin). The review must be **open** (`IN_PROGRESS`); a
DONE/CANCELLED/BLOCKED review cannot send the Blog back. The Blog author,
the Blog's creator and any other member cannot.

For the current `transition_task_with_events(p_task_id, p_actor_id,
p_new_status, p_reason)` signature (no review id), use:

`public.content_os_find_revision_review(target uuid, actor uuid) uuid` — the
qualifying Head Review task id or null (deterministic: oldest qualifying).

### `head_review_completion_allowed(review_task_id)` → `public.content_os_completion_allowed(uuid) boolean`

True for every task except a `HEAD_REVIEW`, which may complete only while its
source Blog is `DONE` (not while the Blog is back in REVISION).

### `posting_checklist_required(task_id)` — Task Bot-owned, no Content OS function

Content OS has **no** posting-checklist concept: no Task Type, workflow step,
Material or channel configuration requires the Task Bot's 4-channel
`#posting` checklist (Content OS publishes one channel per Publish/Schedule
task; a 4-channel checklist would contradict that). The authoritative,
already-persisted signal is the Task Bot's own checklist row:

```sql
-- required:
exists (select 1 from public.task_checklists c where c.task_id = p_task_id and c.kind = 'POSTING')
-- blocks a transition into REVIEW or (new) DONE:
exists (select 1 from public.task_checklists c
        join public.task_checklist_items i on i.checklist_id = c.id
        where c.task_id = p_task_id and not i.is_completed)
```

**Design gap:** the checklist is *attached* by a title/description regex
(`create_task_with_event_v2`, `#posting`). Content OS therefore never sends
the raw tag: `lib/persistence/idempotency.ts` `neutralizePostingTag`
replaces `#` in `#posting` with `＃` for every title it sends, so no Content
OS task gets a checklist by accident (e.g. a Material titled "Why #posting
matters"). Smallest stable replacement if a Content OS task type ever needs
the checklist: an explicit `p_attach_posting_checklist boolean` on the
creation RPC (Task Bot change), never a title convention.

## 3. Exact instructions for Codex — finish A2/A3

In `transition_task_with_events` (A2/A3 migration
`20261014120200_content_os_task_transition_compatibility.sql`):

1. **Keep** the legacy matrix and everything after it unchanged.
2. Replace the Content OS branch (only reached when the legacy matrix
   refuses). A complete, **dry-run-proven** reference body is in
   `docs/persistence/reference/transition_task_with_events.sprint9b.sql`
   (reference only; the Task Bot owns the real migration). The branch:

```sql
-- declare: v_review_task_id uuid;
-- The OUTER IF tests only to_regprocedure. PL/pgSQL plans a whole IF
-- condition as one expression, so a content_os_* call in the same condition
-- would fail to plan (and break every legacy transition) whenever the Content
-- OS schema is absent. Keep the calls in the nested IF.
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
      if exists (select 1 from public.task_checklists c
                 join public.task_checklist_items i on i.checklist_id = c.id
                 where c.task_id = p_task_id and not i.is_completed) then
        raise exception 'posting checklist is incomplete' using errcode = '23514';
      end if;
      v_allowed := true;
    else -- DONE -> REVISION
      v_review_task_id := public.content_os_find_revision_review(p_task_id, p_actor_id);
      if v_review_task_id is null then
        raise exception 'only the source Blog''s Head Review may request this revision' using errcode = '42501';
      end if;
      v_allowed := true;
    end if;
  end if;
end if;
```

3. **Remove** the broad Sprint 9A rule ("DONE → REVISION for any Content OS
   task by creator or Head") — that is the defect.
4. Record `v_review_task_id` in the new path's event metadata (the
   reference appends `|| jsonb_build_object('reviewTaskId', …)` only when it
   is set, so every legacy event's metadata is byte-identical).
5. Head Review completion while its Blog is in REVISION is refused by the
   `content_os_completion_allowed` check above; a Head Review is not
   review-required, so it completes by the direct path.
6. Keep SECURITY INVOKER, `search_path = ''`, signature and EXECUTE grants.

Production order: A1 → A4 → Content OS drafts `00…06` → A2/A3 → wiring.
Thanks to the `to_regprocedure` guard the function is still safe if applied
earlier (legacy behaviour until the functions exist) and after a Content OS
rollback (the functions are dropped; legacy transitions keep working) —
both proven in the dry-run (section 5b).

Required Task Bot tests (dry-run): the nine scenarios in
`supabase/content-os-drafts/dry-run/25_transition_contract_tests.sql`
expressed as transitions — Blog `DONE → REVISION` succeeds only for the
Head Review's assignee or the Head; refused for Research / SEO / a Blog
without its own Head Review / the Blog author / an unrelated member / an
inactive assignee / a BLOCKED or DONE review; `REVISION → DONE` by the Blog
assignee; Head Review `IN_PROGRESS → DONE` refused while its Blog is in
REVISION; legacy 42-transition matrix unchanged.

## 4. Persistence records for the vertical slice

| Step | Task Bot (authoritative) | Content OS rows |
|---|---|---|
| Blog created | `content_os_create_task_idempotent('CREATE_TASK', 'blog:<requestKey>', hash, …)` → task IN_PROGRESS | `content_blogs` (deterministic id from the request key), `content_task_runtime` (pinned BLOG version, `source_task_id` = Research task if any), links PRIMARY BLOG + RELATED KNOWLEDGE_NODE |
| Blog completed | `IN_PROGRESS → DONE` (assignee) | — |
| Head Review opened (once per Blog task) | `content_os_create_task_idempotent('CREATE_TASK', 'head-review:<blogTaskId>', …)` | runtime (pinned HEAD_REVIEW version, `source_task_id` = Blog task), links PRIMARY BLOG (same entity) + RELATED KNOWLEDGE_NODE |
| Revision requested | Blog `DONE → REVISION` (reviewer) | Head Review `field_values` `review-decision = "Revision requested"`, `review-note` |
| Blog corrected | Blog `REVISION → DONE` (assignee); Head Review found by lineage + code, **reused** | — |
| Approved | Head Review `IN_PROGRESS → DONE` (reviewer, only while Blog DONE) | `review-decision = "Approved"` |

Waiting model: the Head Review **stays IN_PROGRESS** while its Blog is in
REVISION (waiting is derived from the Blog's status). This avoids a
cross-actor `BLOCKED → IN_PROGRESS` on someone else's task and the BLOCKED
reason requirement. The local session UI (Sprint 7.1) still parks the
reviewer as BLOCKED; that is session-only demo behaviour and is mapped, not
persisted.

Implementation: `lib/persistence/` (ports, PostgREST adapter, in-memory
adapter, `BlogReviewFlow`); fail-closed by default (`getContentOsPersistence()`).

## 5. Evidence

`supabase/content-os-drafts/dry-run/run-dry-run.sh` on disposable
PostgreSQL 17.11 (`DRY_RUN_EVIDENCE.log`): Sprint 8 contract suite +
`25_transition_contract_tests.sql` (9 scenarios) pass on two fresh
databases; the reference Task Bot function passes
`40_reference_transition_tests.sql` as real transitions (section 5b); Task Bot fingerprint unchanged;
rollback removes all Content OS objects incl. the 06 functions. The Sprint
9A Task Bot harness (read-only, unmodified) also passes with migration 06
applied. Unit tests: `tests/persistence-bridge.test.mjs`.
