# IBOX Content OS V1 — Sprint 8A Persistence Contract

Status: **DESIGN ONLY.** Nothing in this document has been applied anywhere.
Content OS commit audited: `2cbc1ef`. Task-bot commit audited: `1c7bb32`
(`integration/content-os-auth-bridge`). Supabase project:
`cbjcclefgxrdyjwkjcpq` (production, authoritative task backend).

Ownership note: the task-bot repo (`docs/CONTENT_OS_SERVICE_AUTH.md`,
`src/application/ports/task-creation-idempotency-store.ts`) states that Codex
owns the DB-backed `content_*` / idempotency / `external_identity_links`
schema track. This contract is a proposal for that track, written from the
Content OS side. Nothing here changes task-bot application behavior.

---

## A. BASELINE_VERIFICATION

| Check | Result |
|---|---|
| Content OS HEAD | `2cbc1ef` on `migration/supabase-adapter-prep`, clean tree |
| Task-bot HEAD | `1c7bb32` on `integration/content-os-auth-bridge`, clean tree |
| Content OS tests | 545 / 545 pass |
| Content OS lint | 0 errors, 0 warnings (`--max-warnings 0`, exit 0) |
| Content OS typecheck | pass (`tsc --noEmit`, exit 0) |
| Content OS build | pass (exit 0) |

## B. LIVE_SUPABASE_PARITY

**Live catalog was NOT inspected.** This session has no project-scoped
Supabase access: no Supabase connector/tool, no `supabase` CLI, no `psql`
on the host, and no credentials in the environment. Nothing below about the
live database is inferred.

| Object group (12 tables in scope) | Live status |
|---|---|
| columns, PK, FK + actions, CHECK names, UNIQUE, indexes + predicates | **UNKNOWN** |
| triggers, functions/RPC signatures, SECURITY DEFINER/INVOKER, `search_path` | **UNKNOWN** |
| table grants, routine grants, schema privileges, default privileges | **UNKNOWN** |
| RLS enabled/forced, policies | **UNKNOWN** |
| applied migration ledger | **UNKNOWN** |

Only external fact available: the sprint brief states the live
`users.role` CHECK lacks `SEO`; this agrees with the repo definition below.

What *was* verified (repo side, real evidence): the 8 task-bot migrations
were applied in order to a fresh local PostgreSQL 17.11 (matching
`supabase/config.toml` `major_version = 17`) and the read-only audit script
was run against it. Output: `docs/persistence/repo-catalog-baseline.txt`.

Repo-defined catalog summary (the expected side of the parity diff):

| Item | Repo baseline |
|---|---|
| Tables | 12 — users, tasks, task_events, deadline_change_requests, reassign_requests, task_revisions, recurring_definitions, task_checklists, task_checklist_items, report_deliveries, user_events, task_reminder_deliveries |
| RLS | enabled on all 12, not forced, **0 policies** (service_role-only access model) |
| Constraints | 91 in `public` (PK/FK/UNIQUE/CHECK; CHECK names are Postgres-generated, e.g. `users_role_check`, `tasks_status_check`, `tasks_check`, `task_events_event_type_check`) |
| FK actions | every FK `ON DELETE RESTRICT` (`confdeltype = r`), `ON UPDATE NO ACTION` |
| Indexes | 34 (partial: `users_one_active_head_idx`, `users_telegram_username_unique_idx`, `tasks_assignee_open_deadline_idx`, `tasks_status_deadline_idx`, `tasks_recurring_occurrence_unique_idx`, `deadline_change_requests_one_pending_per_task_idx`, `reassign_requests_one_pending_per_task_idx`, `recurring_definitions_due_idx`) |
| Triggers | 8 (updated_at ×5 tables, task_events immutability, task_revisions immutability, telegram-username claim) |
| Functions | 13 in `public`, 5 in `private`; **all SECURITY INVOKER**, all `SET search_path = ''` |
| Table grants | `service_role` only; `task_events`, `task_revisions`, `user_events`: SELECT, INSERT only; `task_checklists`: SELECT, INSERT; no grants to `anon` / `authenticated` |
| Routine grants | every public RPC: EXECUTE to `service_role` only; `private.attach_posting_checklist` EXECUTE to `service_role`; `private` USAGE to `service_role` |
| `users.role` CHECK | OPERATOR_VIDEO_EDITOR, CONTENT_MARKETER, DIGITAL_MARKETER, SMM_MANAGER, HEAD_OF_MARKETING — **no SEO** |

How to close this section (read-only, no mutation possible):

```
psql "$READ_ONLY_DB_URL" -v ON_ERROR_STOP=1 -f docs/persistence/live-catalog-audit.sql > live-catalog.txt
diff docs/persistence/repo-catalog-baseline.txt live-catalog.txt
```

The script wraps everything in `BEGIN TRANSACTION READ ONLY … ROLLBACK`.
Classify each diff hunk MATCH / DIFF / MISSING_IN_LIVE / EXTRA_IN_LIVE. Until
that run exists every live row stays **UNKNOWN**, and **no draft may be
applied to production** (see T).

## C. EXISTING_TABLES_DO_NOT_TOUCH

Authoritative operational data, never rebuilt, altered, or duplicated:

- `public.users` — identity, role, active state.
- `public.tasks` — status, assignee, deadline, creator, priority, title, description, lifecycle timestamps.
- `public.task_events` — append-only operational history (UPDATE/DELETE rejected by trigger).
- `public.task_revisions` — append-only revision history.
- All other task-bot tables (requests, recurring, checklists, deliveries, `user_events`).
- All existing RPCs, including `create_task_with_event_v2` and `transition_task_with_events`.

Hard rules: **no `tasks.content_ref`, no new column on any task-bot table, no
second operational task table, no change to the `users.role` CHECK in this
track.** Content OS tables reference `public.tasks(id)` / `public.users(id)`
by FK only, always `ON DELETE RESTRICT` (the house convention).

## D. LOCAL_TO_PERSISTENT_MODEL_MAP

Source of truth for the left column: the code at `2cbc1ef`
(`lib/content-entity.ts`, `lib/task-instance.ts`, `lib/task-type.ts`,
`lib/workflow-template.ts`, `lib/task-link.ts`, `lib/task-runtime-store.ts`).

### Content

| Local (field) | Persistent | Notes |
|---|---|---|
| `Domain` | `content_domains` | |
| `ProblemCategory.domainId` | `content_problem_categories.domain_id` | legacy `CP-*` → `legacy_ref` |
| `ProblemPart.problemCategoryId, sourceTaskId` | `content_problem_parts` | `source_task_id` → `public.tasks(id)` |
| `KnowledgeNode.problemPartId, sourceTaskId` | `content_knowledge_nodes` | legacy `ND-*` → `legacy_ref` |
| `KnowledgeNode.status` (UNPLANNED/PLANNED) | **not stored — derived** | PLANNED ⇔ a `content_blogs` row exists for the node (that is the only writer of PLANNED today) |
| `Blog` | `content_blogs` | `state` stored (it is a real editorial state) |
| `Material` | `content_materials` | `destination_id` NULLable; `angle_id` NULLable |
| `Material.shootSessionId` + `ShootSession.materialIds` | `content_materials.shoot_session_id` only | the local model stores the same fact twice; persist once, derive the list |
| `Angle` | `content_angles` | belongs to exactly one node |
| `Destination` | `content_destinations` | belongs to one problem category; `owner` (free text locally) → `owner_user_id` → `public.users` |
| `AngleDestinationLink` | `content_angle_destination_links` | M:N |
| `RepurposeMap` | `content_repurpose_maps` | → blog |
| `AtomicIdea` | `content_atomic_ideas` | `selected_formats text[]`; generation is 1:N via `content_materials.primary_atomic_idea_id` |
| `ShootSession` | `content_shoot_sessions` | `status` and `assignee` **not stored**: derived from the session's Shoot task (`public.tasks` status/assignee) via `content_task_links` |
| `MaterialResultReview` | `content_material_result_reviews` + `content_material_result_review_sources` | sources are real task FKs, not an array |

### Config

| Local | Persistent |
|---|---|
| `TaskType` (id, version, isActive) | `content_task_types` (identity) + `content_task_type_versions` (immutable definition incl. prompt + `prompt_version`) |
| `WorkflowTemplate` (id, version, isActive) | `content_workflow_templates` + `content_workflow_template_versions` (DRAFT → PUBLISHED, then immutable) |
| `WorkflowStep` (+ `dependsOn`, `overrides`) | `content_workflow_steps` (per template version) + `content_workflow_step_dependencies` |

### Runtime (keyed by the real `public.tasks.id`)

| Local `TaskInstance` field | Persistent | Notes |
|---|---|---|
| `id` | **`public.tasks.id`** | no new operational identity |
| `title`, `status`, `assignee`, `deadline` | **`public.tasks`** (authoritative) | not duplicated |
| `taskTypeId` (+ version at creation) | `content_task_runtime.task_type_version_id` | pins the definition used |
| `workflowTemplateId` | `content_task_runtime.workflow_run_id` → run → pinned template version | |
| `workflowStepId` | `content_task_runtime.workflow_step_id` | step row of the pinned version |
| `sourceTaskId` | `content_task_runtime.source_task_id` → `public.tasks(id)` | concrete lineage (J) |
| `contentRef`, `relatedEntityRefs` | `content_task_links` (PRIMARY / RELATED) | (I) |
| `fieldValues`, `customFields`, `fieldProvenance`, `atomicIdeaDrafts` | `content_task_runtime` JSONB columns | (K) |
| `links` | `content_task_url_links` | (K) |
| `outcome`, `skipReason` | `content_task_runtime.outcome / skip_reason` | `tasks` only knows CANCELLED; SKIPPED vs cancelled is Content OS meaning |
| `reviewEvents` | **not stored** | `task_events` (REVIEW_REQUESTED / REVISION_REQUESTED, reason in metadata) + `task_revisions` are authoritative |
| `TemplateImprovementSuggestion` | `content_task_type_suggestions` | |

Not persisted (derived or UI-only): KnowledgeNode status, ShootSession
status/assignee, Ready-for-Shoot / Ready-for-Distribution / publish blockers /
Learning-due (all derived since Sprint 6/7), Production Queue "Local now".

## E. ERD / RELATIONSHIP_MODEL

```
public.users ◄──────────────┬──────────────┬──────────────────────────────┐
     ▲                      │              │                              │
     │ creator/assignee     │ owner_user   │ linked_by/revoked_by/user    │ created_by
public.tasks ◄───────┬──────┼──────────────┼───────────┬──────────────────┤
     ▲  ▲  ▲         │      │              │           │                  │
     │  │  │   content_task_runtime (PK task_id) ── source_task_id ──► public.tasks
     │  │  │         ├─► content_task_type_versions ──► content_task_types
     │  │  │         ├─► content_workflow_runs ──► content_workflow_template_versions ──► content_workflow_templates
     │  │  │         └─► content_workflow_steps ──► (same template version)  ◄── content_workflow_step_dependencies
     │  │  content_task_links (task_id, entity_type, entity_id, PRIMARY|RELATED) ──► any content entity (validated)
     │  content_task_url_links (task_id, position, label, url)
     content_os_idempotency_keys (purpose, key) ──► task_id

content_domains ◄─ content_problem_categories ◄─ content_problem_parts ◄─ content_knowledge_nodes ◄─ content_blogs
                         ▲                                                    ▲                        ▲   ▲
                         └── content_destinations ◄──┐                        └── content_angles ◄─┐   │   └─ content_repurpose_maps ◄─ content_atomic_ideas
                                   ▲                 └─ content_angle_destination_links ───────────┘   │
                                   │                                                                    │
content_materials ─► blog ─────────┼────────────────────────────────────────────────────────────────────┘
      ├─► destination (NULLable)   │
      ├─► angle (NULLable), primary_atomic_idea (NULLable for legacy), shoot_session (NULLable) ─► content_shoot_sessions
      └─◄ content_material_result_reviews (1:1) ◄─ content_material_result_review_sources (publish task_id ─► public.tasks)

external_identity_links (provider, tenant_key, external_subject) ─► public.users
```

Cardinalities that must hold (all supported):
one task ↔ many entities (PRIMARY ≤ 1); one entity ↔ many tasks; Research →
many KnowledgeNodes (RELATED); Shoot → its ShootSession (PRIMARY);
one Material → many tasks; one AtomicIdea → many Materials (one per format).

## F. CONTENT_TABLE_CONTRACTS

All tables: `id uuid PK default gen_random_uuid()`, `created_at`, `updated_at`
(updated by the existing `private.set_updated_at()` trigger), RLS on, no
policies, service_role-only grants (O). `legacy_ref text NULL` +
`legacy_source text NULL` where a legacy stable ref exists, with a partial
UNIQUE index on `legacy_ref` where not null. Every FK `ON DELETE RESTRICT`.
Enum CHECK values are exactly the local `as const` arrays.

| Table | Columns (beyond common) | Key constraints |
|---|---|---|
| `content_domains` | name | name 1..200 |
| `content_problem_categories` | domain_id, name, legacy_ref (CP-*) | FK domain |
| `content_problem_parts` | problem_category_id, name, source_task_id | FK category, FK task |
| `content_knowledge_nodes` | problem_part_id, name, source_task_id, legacy_ref (ND-*) | FK part (NOT NULL) |
| `content_blogs` | knowledge_node_id, title, primary_link, state, source_task_id | state ∈ PLANNED/DRAFT/APPROVED/PUBLISHED; primary_link http(s) |
| `content_angles` | knowledge_node_id, title, short_description, category, pain/clarity/evidence/ibox_relevance scores, organic/performance potential, usage, priority, source_task_id | scores `numeric NOT NULL DEFAULT 0 CHECK (>= 0)` (local code defines no upper bound — see S); usage ∈ ORGANIC/PERFORMANCE/BOTH; priority ∈ NOW/LATER/TEST |
| `content_destinations` | problem_category_id, name, type, value_proposition, status, primary_url, owner_user_id, deadline (date), source_task_id | type ∈ YOUTUBE/CHECKLIST_OR_PDF/EXTERNAL_TOOL_OR_URL; status ∈ PLANNED/IN_PROGRESS/READY |
| `content_angle_destination_links` | angle_id, destination_id | PK (angle_id, destination_id) |
| `content_repurpose_maps` | blog_id, source_task_id | FK blog |
| `content_atomic_ideas` | repurpose_map_id, position, text, coverage_type, decision, selected_formats text[], angle_id, destination_needed | coverage ∈ PROBLEM/CAUSE/CONSEQUENCE/SOLUTION/OTHER; decision ∈ CREATE_CONTENT/BLOG_ONLY/LATER; formats ⊆ {REEL, CAROUSEL, TEXT_POST, YOUTUBE}; UNIQUE (repurpose_map_id, position) |
| `content_shoot_sessions` | title, scheduled_on (date) | status/assignee derived from the Shoot task |
| `content_materials` | blog_id, title, format, primary_atomic_idea_id, angle_id, destination_needed, destination_id, cta_type, cta_text, shoot_session_id, status, source_task_id, legacy_ref (TPI-*) | format ∈ 4; status ∈ PLANNED/IN_PRODUCTION/READY/PUBLISHED; cta_type ∈ 8 or NULL; `(cta_type IS NULL) = (cta_text IS NULL)`; **destination_id NULLable**; UNIQUE (primary_atomic_idea_id, format) WHERE idea not null (one Material per idea×format — the documented V1 rule) |
| `content_material_result_reviews` | material_id (PK), result_review_at | 1 per Material |
| `content_material_result_review_sources` | material_id, publish_task_id, confirmed_at | PK (material_id, publish_task_id); latest `confirmed_at` = the Learning task's source |

Cross-row rules the DB does **not** enforce (kept in the app, as today):
Material's destination belongs to the same problem category; an Angle–
Destination link stays within one category; Learning summary is read from
the latest DONE Learning task's `field_values` (not copied, see §15 of the
brief).

## G. TASK_CONFIG_TABLE_CONTRACTS

| Table | Columns | Rules |
|---|---|---|
| `content_task_types` | code (UNIQUE, stable machine key), legacy_ref (TT-*), is_active, current_version_id | `(id, current_version_id)` FK → versions `(task_type_id, id)` so "current" can only point at its own version |
| `content_task_type_versions` | task_type_id, version (>0), name, description, definition jsonb (required/optional fields, assignee rule, recommended day, allowed link labels, completion requirements), review_required, review_stage, default_prompt, prompt_version, created_by | UNIQUE (task_type_id, version); prompt ⇒ prompt_version; **immutable** (UPDATE/DELETE rejected by trigger) |
| `content_workflow_templates` | code, legacy_ref (WF-*), is_active, current_version_id | current must be PUBLISHED and belong to the template |
| `content_workflow_template_versions` | template_id, version, name, description, module_type, status DRAFT/PUBLISHED, published_at, created_by | only DRAFT→PUBLISHED allowed; PUBLISHED rows immutable; DRAFT deletable |
| `content_workflow_steps` | template_version_id, step_key (local step id / legacy Step_ID), task_type_id, name_template, blocking, skippable, overrides jsonb, step_order, legacy_ref | UNIQUE (template_version_id, step_key); writable only while the version is DRAFT |
| `content_workflow_step_dependencies` | template_version_id, step_id, depends_on_step_id | composite FKs force both steps into the **same** version; no self-dependency; cycles validated by the app (`validateWorkflowTemplate`) before publishing |

Steps reference the Task Type **identity**, not a version — exactly today's
behavior ("Task Type edit is immediately visible in the Workflow Builder").
The version actually used is pinned per task at creation (H).

## H. TASK_RUNTIME_METADATA_CONTRACT

Name chosen after inspecting the runtime: **`content_task_runtime`**, one row
per Content OS-managed `public.tasks` row (PK = `task_id`, FK RESTRICT). A
Telegram-created task simply has no row.

| Column | Meaning |
|---|---|
| task_id | PK, FK `public.tasks(id)` |
| task_type_version_id | NOT NULL — exact definition/prompt the task was created with |
| workflow_run_id, workflow_template_version_id, workflow_step_id | NULL for standalone tasks (Planning, Shoot, Publish…); composite FKs guarantee the step belongs to the run's pinned version |
| source_task_id | concrete lineage, FK `public.tasks(id)`, ≠ task_id |
| outcome, skip_reason | NULL / COMPLETED / SKIPPED; `skip_reason` present iff SKIPPED |
| field_values jsonb (object) | structured + custom field values |
| custom_fields jsonb (array) | per-task custom field definitions |
| field_provenance jsonb (array) | context-transfer provenance |
| atomic_idea_drafts jsonb (array) | Repurpose Map drafts before confirm |

New table **`content_workflow_runs`** (id, template_version_id [PUBLISHED],
root_entity_type/id, started_by → users, started_at). The local runtime has no
run id (it filters by template id, so two runs of one template would mix);
persistence needs one.

Deliberately **not** duplicated: status, assignee, deadline, creator, title,
completion/cancel timestamps, review history.

## I. CONTENT_TASK_LINKS

Compared:

- **A — polymorphic** `(task_id, entity_type, entity_id, relation)`: mirrors
  local `ContentEntityRef` 1:1, one table, one reverse-lookup index, new entity
  types need only a CHECK change. Weakness: no native FK to the entity.
- **B — typed** one nullable FK column per entity type plus an exactly-one
  CHECK: real FKs, but 10 columns that must be kept in sync, and an awkward
  reverse lookup per type.

**Chosen: A**, closing its gap with (1) an insert/update trigger that rejects
an `entity_id` that does not exist in the table for its `entity_type`, and
(2) no DELETE grant on any content entity table (entities are never
hard-deleted in V1), so a link cannot dangle.

Contract: `content_task_links(task_id → tasks RESTRICT, entity_type ∈ local
CONTENT_ENTITY_TYPES, entity_id uuid, relation PRIMARY|RELATED, created_at)`;
PK `(task_id, entity_type, entity_id)` (idempotent re-link); partial UNIQUE
`(task_id) WHERE relation = 'PRIMARY'` (local `contentRef` is single);
index `(entity_type, entity_id)` for "all tasks of this Material". No ALTER of
`public.tasks`.

## J. TASK_LINEAGE

Local lineage is single-parent (`sourceTaskId`), and every behavior that needs
it uses exactly that one edge:

| Behavior | Edge |
|---|---|
| Blog → Head Review / SEO / Angle / PC | child.source = Blog task |
| Head Review "Revision requested" returns to the **same** Blog | reviewer.source = Blog task; no new row is ever created |
| Research → many Blogs | each Blog.source = the Research task |
| Shoot → Edit / Cover / Caption ×N | each.source = the Shoot task |
| Distribution Plan → channel Publish/Schedule | each.source = the plan task |
| Publish/Schedule → Publish Check → Learning | check.source = publish task; Learning.source = latest result-review source |

Decision: **`content_task_runtime.source_task_id`** (FK → `public.tasks`,
indexed for reverse lookup). A separate lineage table would only be needed
for multi-parent edges, which V1 does not have (Destination Decision's
convergence is computed from content entities, not stored). Workflow step
ids are never used to infer lineage.

## K. STRUCTURED_FIELDS_AND_LINKS

- Field values: **JSONB on `content_task_runtime`** (option A). The values
  are read and written as a whole per task, validated by the Task Type version
  in app code, and never queried across tasks except Learning's latest
  summary (one task lookup). Normalized tables would add a type-per-column
  problem (9 field types) with no concrete benefit. CHECKs pin the JSON
  shape (`jsonb_typeof = 'object'` / `'array'`).
- Named links: **`content_task_url_links`** `(id, task_id → tasks, position,
  label, url)`, UNIQUE `(task_id, position)` for stable ordering, url must be
  http(s). No file storage. (Named "url_links" to avoid colliding with the
  entity bridge `content_task_links`.)

## L. VERSIONING_MODEL

- Task Type: stable identity row + immutable version rows. Editing a Task
  Type inserts version N+1 and moves `current_version_id`; tasks keep their
  pinned `task_type_version_id`, so a v2 task never silently becomes v5.
  The prompt is part of the version; `prompt_version` is recorded alongside.
- Workflow Template: identity + version (DRAFT while being built, PUBLISHED
  then frozen) + steps/dependencies owned by the version. Runs pin a
  PUBLISHED version. A new edit = new DRAFT version copied from current.
- History is never overwritten: UPDATE/DELETE of published config rows is
  rejected by trigger, and `service_role` has no DELETE grant on them.

## M. IDEMPOTENCY_MODEL

Options compared:

| Option | Verdict |
|---|---|
| Reuse `tasks.source_telegram_update_id` | **Rejected** (forbidden; Telegram semantics, bigint, would collide with bulk `update_id*100+i`) |
| Purpose-specific UNIQUE on content tables only | Covers B/C but not A, and not "same key + different request" |
| Task-bot port `findExistingTaskId` then `claim(key, taskId)` | **Not safe as specified**: the claim happens after the task exists, so two concurrent retries can both create a task |
| **One ledger + atomic RPC** | **Chosen** |

`content_os_idempotency_keys(purpose, idempotency_key, request_hash, task_id
→ tasks RESTRICT, created_at)`, PK `(purpose, idempotency_key)`, insert-only.

Purposes and deterministic keys:

| Purpose | Key | Guarantee |
|---|---|---|
| `CREATE_TASK` (A) | caller-supplied key | retry returns the same task |
| `PUBLISH_CHECK` (B) | the scheduled Publish task id | one Publish Check per scheduled publish |
| `MATERIAL_LEARNING` (C) | the Material id | exactly one automatic Learning per Material |

`public.content_os_create_task_idempotent(...)` (SECURITY INVOKER,
`search_path = ''`, EXECUTE to service_role only) runs in one transaction:
`pg_advisory_xact_lock` on (purpose, key) → if a row exists: same
`request_hash` ⇒ return that task (`created = false`), different hash ⇒
raise `IDEMPOTENCY_KEY_REUSED`; else call the existing
`create_task_with_event_v2` (unchanged) and insert the ledger row. The PK is
the backstop: a racing duplicate fails and rolls back its own task. Runtime
metadata and links are then upserted keyed by `task_id`, so a crash between
the two steps is repaired by retrying with the same key.

## N. EXTERNAL_IDENTITY_MODEL

`external_identity_links` (design; table drafted, **not enabled**; owner =
task-bot track):

| Column | Rule |
|---|---|
| provider | CHECK = `OPENAI_SIWC` (only provider in scope) |
| tenant_key | NOT NULL; the SIWC workspace/tenant the subject belongs to |
| external_subject | the `oai-authenticated-user-id`, never a `users.id` |
| user_id | → `public.users(id)` RESTRICT; never a shared service user |
| status | ACTIVE / REVOKED |
| linked_by | → users (must be the Head — enforced by the future link RPC) |
| linked_at, verified_at | verification timestamp |
| revoked_by, revoked_at, revoke_reason | all set iff REVOKED |

Partial UNIQUE `(provider, tenant_key, external_subject) WHERE status =
'ACTIVE'` = one active mapping; history kept by revoking and inserting a new
row (no DELETE grant; trigger allows only ACTIVE→REVOKED and setting
`verified_at`). Resolution joins `users.is_active`, so a disabled user fails.
No Telegram backfill. Service auth stays off.

## O. RLS_AND_GRANTS_PLAN

Follow the task-bot house pattern exactly (fail-closed):

- RLS ENABLED on every new table, **no policies** → `anon` / `authenticated`
  can read/write nothing even if a grant slips in.
- `REVOKE ALL … FROM public, anon, authenticated` on every table and function.
- `service_role` (trusted server only, never shipped to a browser):
  - content entities / runtime / links / url links / suggestions / result
    reviews: SELECT, INSERT, UPDATE — **no DELETE**;
  - config versions, step tables, idempotency ledger, review sources:
    SELECT, INSERT only (+ UPDATE on template versions for DRAFT→PUBLISHED and
    on identity rows for `current_version_id` / `is_active`);
  - `external_identity_links`: SELECT, INSERT, UPDATE (revocation only).
- New RPC: EXECUTE to service_role only. New trigger functions live in
  `private` (already USAGE-granted to service_role only).
- Not exposed to the client: Content OS reads through its own server.
- Ownership: objects owned by `postgres` (migration role), as today.

## P. SHEET_IMPORT_MAP

Google Sheets becomes import/archive/export only, never written back.

| Target | Legacy source (tab) | Stable ref | Transformation | Order |
|---|---|---|---|---|
| content_domains | area config (`01..05_*_JARAYON_XARITASI`, area ids xarid/ombor/savdo/moliya/management) | area id | one row per area | 1 |
| content_problem_categories | `11_CANONICAL_MUAMMOLAR` | `Canonical_Problem_ID` (CP-*) | title ← `Canonical_Muammo`; domain via area problem tabs `06..10_*_MUAMMOLAR_XARITASI` | 2 |
| content_problem_parts | *(no 1:1 legacy tab)* | — | **decision needed** (S): `12_CONTENT_CLUSTER_MAP` clusters (CL-*) are the nearest candidate | 3 |
| content_knowledge_nodes | `13_CONTENT_NODES` | `Node_ID` (ND-*) | name ← `Working_Title`/`Main_Question`; legacy node links to *many* CP ids → parent part needs a rule (S) | 4 |
| content_task_types (+v1) | `23_TASK_TEMPLATES` | `Task_Template_ID` (TT-*) + `Template_Version` | definition from template row; code from name | 5 |
| content_workflow_templates (+v1, steps, deps) | `25_WORKFLOW_STEPS` | `Workflow_ID` (WF-*), `Step_ID`, `Dependency_Step_IDs` | one PUBLISHED version per Workflow_ID | 6 |
| content_materials | `35_TOPIC_PACKAGE_ITEMS` | `Package_Item_ID` (TPI-*) | `Format_Code` → format; blog via `Source_Node_ID` | 7 |
| *(archive only)* | `33_TOPIC_PACKAGE_PLAN` (TP-*), `16_PRODUCTION_SYSTEM`, `22_PRODUCTION_TASKS` | kept in `legacy_ref` / archive export | not operational in V1 | — |

Validation per run: duplicate-ID report (the adapter already flags duplicates
such as `CP-DUP`), dangling refs, enum mapping misses. Reconciliation:
row-count by tab vs table, every legacy ref present exactly once, import is
idempotent on `legacy_ref` (partial unique index).

## Q. MIGRATION_ORDER

1. `content_os_00_helpers` — private trigger functions.
2. `content_os_01_content_entities` — domains → categories → parts → nodes → blogs → angles → destinations → links → repurpose maps → atomic ideas → shoot sessions → materials → result reviews (+ sources).
3. `content_os_02_task_config` — task types/versions, workflow templates/versions/steps/dependencies, current-version FKs.
4. `content_os_03_task_runtime` — workflow runs, task runtime, content_task_links (+ entity validation), url links, suggestions.
5. `content_os_04_idempotency` — ledger + `content_os_create_task_idempotent`.
6. `content_os_05_external_identity_links` — task-bot-owned; may land in that repo instead.
7. `content_os_99_down` — rollback (dry-run only).

All run strictly **after** the 8 task-bot migrations; none edits them.

## R. ROLLBACK_PLAN

- Every draft is additive (new tables, new functions, new triggers on new
  tables only). Rollback = drop in reverse order; no task-bot object is
  touched, so the task bot is unaffected either way.
- Before production apply: catalog snapshot (audit script) + data export of
  any rows written.
- Data written by Content OS after go-live is lost on rollback unless
  exported first; operational tasks it created remain valid tasks in
  `public.tasks` (they are ordinary tasks).
- The down script is exercised in the 8B dry-run (apply → down → re-apply).

## S. OPEN_PRODUCT_DECISIONS

1. **BLOCKER for wiring (not for schema) — status-machine parity.** Production
   (`transition_task_with_events` + `src/domain/workflow.ts`) only allows
   DONE via APPROVE from REVIEW, by Head or creator; DONE can only REOPEN to
   ASSIGNED; BLOCKED needs a reason. The local V1 runtime
   (a) completes ASSIGNED/IN_PROGRESS → DONE directly, and (b) since Sprint
   7.1 moves a **DONE** Blog to REVISION and parks Head Review BLOCKED.
   Options: map Complete = SUBMIT_REVIEW + APPROVE (every content task gets a
   creator/Head approval), or extend the task-bot transition model (task-bot
   behavior change, owner Codex). Head Review → Blog revision then maps to
   either production REVIEW→REVISION on the Blog itself (which re-introduces
   the review that Sprint 7.1 removed from the Blog) or REOPEN (DONE→ASSIGNED).
2. **Required operational fields.** `tasks.assignee_id` and `tasks.deadline`
   are NOT NULL; local tasks can exist without them (preview defaults,
   reconciler-created Publish Check / Learning). Content OS must resolve a
   real assignee and deadline before creating a task.
3. **SEO role** — `users.role` CHECK has no SEO (repo; live per brief). Fixture
   "SEO" assignee rule cannot resolve. Separate task-bot migration; code TBD.
   `SMM_MANAGER` stays for compatibility.
4. **Role mapping** of Task Type FIXED_ROLE strings ("Operator / Montajer",
   "Digital marketer", "Head", "SEO") to `users.role` codes.
5. **Handler binding.** Local runtime handlers are keyed by Task Type *name*;
   a rename detaches special behavior. Persisted identity carries a stable
   `code`; the code registry should move to it (later code change).
6. **Legacy hierarchy**: what a ProblemPart is in legacy data (CL-* clusters?)
   and how many-CP nodes pick one parent.
7. **Angle score scale** (local code has no upper bound).
8. **Identity provider string**: the auth header `x-content-os-actor-provider`
   example is `content-os`; the mapping provider is `OPENAI_SIWC`. Pick one
   meaning for the resolver input.
9. `tenant_key` source for SIWC subjects.

## T. SAFE_TO_DRAFT_MIGRATIONS = **YES**

Drafting and dry-running locally is safe: drafts are additive, live outside
the task-bot repo, and are exercised only on a disposable local PostgreSQL 17
built from the task-bot repo migrations.

**Not safe to APPLY to production** until (1) the live catalog audit (B) is
run and shows no blocking DIFF, (2) decisions S1–S3 are made, and (3) the
task-bot owner reviews the drafts.
