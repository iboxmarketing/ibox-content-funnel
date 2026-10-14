# Sprint 9 — Task Bot integration plan (Content OS persistence)

Starting point: Sprint 8 closed (`SPRINT_8A_PERSISTENCE_CONTRACT.md` §T, §U).
`STRUCTURAL_PARITY = PASS`, `CONTENT_OS_DRAFT_SAFETY = PASS`,
`PRODUCTION_APPLY = HOLD`. Content OS `migration/supabase-adapter-prep`;
task-bot `integration/content-os-auth-bridge` at `1c7bb32`. Nothing applied
to Supabase, nothing pushed or deployed.

Two tracks. **Track A changes the task bot and is owned/reviewed by the
task-bot track** — every item is its own migration/PR in
`marketing-team-task-bot`, never mixed into the Content OS content-schema
migrations. **Track B** is the Content OS persistence bridge and starts its
production apply only after Track A has been reviewed.

Non-negotiables for both tracks:

- `public.users`, `public.tasks`, `public.task_events` stay authoritative
  (status, assignee, deadline, creator, operational history).
- No `tasks.content_ref`; no second operational task table; no new task
  statuses (the existing seven only).
- Every migration is dry-run first on disposable PostgreSQL 17 built from the
  task-bot migrations with the Supabase default privileges emulated
  (`supabase/content-os-drafts/dry-run/`), and checked against the live
  catalog read-only (`docs/persistence/live-catalog-audit.sql` +
  `compare-catalog.py`) before and after any apply.

---

## TRACK A — task-bot compatibility changes

### A1. `SEO_SPECIALIST` role migration (approved: S0/D2)

- One task-bot migration: replace `users_role_check` (name verified live)
  with the same list plus `SEO_SPECIALIST`. `SMM_MANAGER` stays.
- Application: `TEAM_ROLES` / `NON_HEAD_ROLES` in
  `src/domain/permissions.ts`, the role schema in `src/domain/models.ts`,
  activation / role-edit flows and their labels, tests.
- Exit: live `users_role_check` contains `SEO_SPECIALIST`; activation as SEO
  works; no existing user's role changes.

### A2. Narrow state-machine extension (approved: S0/D1)

Required flows, existing statuses only:

| Flow | Today | Needed |
|---|---|---|
| Normal Content OS task | IN_PROGRESS → DONE not allowed | IN_PROGRESS → DONE |
| Review-required task | IN_PROGRESS → REVIEW → DONE (APPROVE) | unchanged |
| Revision of a source Blog | DONE can only REOPEN → ASSIGNED | DONE → REVISION |
| Corrected Blog | REVISION → DONE not allowed | REVISION → DONE |

Touch points: `public.transition_task_with_events` (DB transition matrix,
events, `completed_at` handling — the `(status = 'DONE') = (completed_at is
not null)` CHECK must keep holding) and `src/domain/workflow.ts`
(`TRANSITIONS`, actions, permissions).

**Decision needed in A2 review — how "narrow" is enforced.** The new
transitions must not become available to ordinary Telegram tasks. Options:

1. Allow them only for tasks that have a `content_task_runtime` row (and,
   for IN_PROGRESS → DONE, whose pinned Task Type version has
   `review_required = false`). Most precise, but the DB function then
   references Content OS tables, so the function change deploys **after**
   Track B schema apply (B1), even though it is reviewed first.
2. Allow them only for actors arriving through the Content OS service-auth
   path. Keeps the DB untouched but puts the rule in application code only.

Recommendation: option 1 (rule enforced in the same transaction as the
status change), sequenced A-review → B1 → A2 deploy.

### A3. Revision behavior required by Content OS

- Who may move a DONE Blog to REVISION: Head, or the authorized reviewer
  (the assignee of the Head Review task whose `source_task_id` is that
  Blog, per `content_task_runtime`). Reason required; append
  `REVISION_REQUESTED` event and a `task_revisions` row, exactly as the
  existing REVIEW → REVISION path does.
- REVISION → DONE: the Blog's assignee; `TASK_COMPLETED` event.
- The reviewer task's waiting state maps onto existing transitions:
  IN_PROGRESS → BLOCKED (reason required) while the Blog is in revision,
  BLOCKED → IN_PROGRESS (RESUME) on resubmission. Locally the reviewer goes
  back to ASSIGNED; production uses RESUME — no new transition needed.
- **Posting checklist:** today the incomplete-`#posting`-checklist rule is
  enforced only on the transition to REVIEW. Any new direct path to DONE
  (IN_PROGRESS → DONE, REVISION → DONE) must enforce the same rule.
- Telegram / Mini App notifications and actions for the new transitions.

### A4. Existing `service_role` privilege hardening (separate, reviewed)

- Gap (live audit §B): the 12 operational tables keep Supabase-default
  TRUNCATE / REFERENCES / TRIGGER / MAINTAIN for `service_role` because the
  task-bot migrations revoke only from `public, anon, authenticated`.
- One task-bot migration: revoke exactly those four privileges from
  `service_role` on the 12 tables; leave the application grants unchanged.
  No TRUNCATE use exists in task-bot `src`.
- Owner decision inside A4: whether to also change the project's default
  privileges for future `public` tables (affects every future migration, not
  only the task bot).
- Exit: live audit shows only the repo-defined `service_role` privileges on
  the 12 tables; task-bot regression tests pass.

### Track A exit (unblocks Track B apply)

A1–A4 drafted, dry-run, and reviewed by the task-bot owner; A1 and A4 may be
applied independently; A2/A3 deploy order per the A2 decision.

---

## TRACK B — Content OS persistence bridge

### B0. Preconditions

- Track A reviewed (above).
- S6 (legacy hierarchy) decided if its answer would make
  `content_knowledge_nodes.problem_part_id` nullable; otherwise it only
  gates B7.
- Migration owner approval of `supabase/content-os-drafts/migrations/`.

### B1. Apply the Content OS schema

- Apply the drafts in order (`00` … `04`) unchanged unless review finds a
  defect. `05_external_identity_links` only if the owner keeps it in this
  track; otherwise it moves to the task-bot repo and stays disabled.
- Before/after: live read-only audit + comparator; task-bot objects must be
  identical; rollback script ready.
- Versioning and idempotency rules stay exactly as drafted.

### B2. Server-side repository (Content OS server only)

- `service_role` from the server only, never a browser key.
- Content entities read/write; `content_task_runtime` keyed by the existing
  `tasks.id`; `content_task_links` (PRIMARY/RELATED) bridges tasks to
  entities; ordered `content_task_url_links`.
- Status, assignee, deadline, creator are read from `public.tasks` and
  changed only through task-bot RPCs/actions.

### B3. Task creation

- Only through `public.content_os_create_task_idempotent` with
  deterministic keys: `CREATE_TASK` (request key), `PUBLISH_CHECK`
  (scheduled publish task id), `MATERIAL_LEARNING` (material id). Then
  upsert runtime + links keyed by `task_id` (retry-safe).
- Resolve a real assignee and deadline before creating (S2 —
  `tasks.assignee_id` / `tasks.deadline` are NOT NULL).
- FIXED_ROLE strings → `users.role` codes (S4, **proposed, to confirm**):

  | Fixture string | Role code |
  |---|---|
  | `Head` | `HEAD_OF_MARKETING` |
  | `SEO` | `SEO_SPECIALIST` (needs A1) |
  | `Operator / Montajer` | `OPERATOR_VIDEO_EDITOR` |
  | `Digital marketer` | `DIGITAL_MARKETER` |

### B4. Status transitions

- Map local Complete / Submit / Approve / Request revision / Resubmit onto
  the A2/A3 flows; no Content OS-side status writes.

### B5. Config persistence

- Seed Task Types / Workflow Templates from the fixtures as version 1 with
  stable `code`s; publish workflow versions; pin versions per task.
- Move runtime handler binding from display name to `code` (S5).

### B6. Reconcilers

- Publish Check and Learning reconcilers use the `PUBLISH_CHECK` /
  `MATERIAL_LEARNING` keys; repeated runs return the existing task.

### B7. Legacy Sheet import (after S6)

- Per contract §P; Sheets become archive/export only; idempotent on
  `legacy_ref`.

### B8. Service auth / identity links (separate, later)

- Only after S8 (resolver provider string) and S9 (`tenant_key` source) are
  decided and the task-bot owner wires a real resolver.
  `CONTENT_OS_SERVICE_AUTH_ENABLED` stays false until then.

---

## Sequence

```
A1 (SEO role) ─┐
A4 (svc hardening) ─┤
A2 + A3 reviewed ─┴─► B1 schema apply ─► A2/A3 deploy ─► B2 → B3 → B4 → B5 → B6
                                                         B7 after S6;  B8 after S8/S9
```

Out of scope for Sprint 9: new task statuses, `tasks.content_ref`, any
second task table, enabling service auth before B8's conditions.
