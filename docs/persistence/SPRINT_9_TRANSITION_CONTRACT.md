# Sprint 9 — Content OS transition contract (handoff to Task Bot A2/A3)

Status: **DESIGN + LOCAL DRY-RUN + IN-PROCESS TESTS ONLY.** Nothing applied
to Supabase, nothing pushed or deployed, **no live integration has run**.
Content OS branch `sprint-9b/persistence-bridge` (Sprint 9B from `ae4873d`,
Sprint 9C application wiring from `15d8402`). The Task Bot side is Codex's
final A2/A3 function on `codex/sprint-9b-hardening` @ `a9ed78a`
(`20261014130332_content_os_task_transition_compatibility.sql`), read
read-only. Content OS did not modify any Task Bot repo or branch.

Product rules (approved, unchanged): Blog is **not** review-required; when a
Blog completes, one separate **Head Review** task opens; the Head Review may
send **that same** Blog back (`DONE → REVISION`); the author fixes it
(`REVISION → DONE`); the **same** Head Review is reused. No new statuses.
Approved Head Review lifecycle: `IN_PROGRESS → BLOCKED` on revision request,
`BLOCKED → ASSIGNED` on resubmission, reviewed again, `→ DONE` on approval
(§4).

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

## 3. Task Bot implementation (final: Codex `a9ed78a`)

The Task Bot owns `public.transition_task_with_events`; Content OS only
supplies the predicates above and calls the RPC. The final function
(`codex/sprint-9b-hardening` @ `a9ed78a`) does exactly this:

1. Legacy matrix and legacy event behaviour unchanged for every task.
2. The Content OS completion gate (`content_os_completion_allowed`) also
   constrains legacy paths into DONE (e.g. `REVIEW → DONE`), so a Head Review
   cannot bypass the source-Blog gate by entering REVIEW first.
3. Only when the legacy matrix refuses, and only for a Content OS task:
   - `IN_PROGRESS/REVISION → DONE` for a non-review-required task, by its
     assignee, completion gate + posting-checklist rule enforced;
   - Blog `DONE → REVISION` only via `content_os_find_revision_review`
     (the Blog's own open Head Review; its assignee or the active Head);
     the review row is locked, must be `IN_PROGRESS`, and is set
     **`BLOCKED`** (reason `Waiting for source Blog revision`) **in the same
     transaction**;
   - Blog `REVISION → DONE` recovers the review id from the latest
     `REVISION_REQUESTED` event's `metadata.reviewTaskId`, locks it, requires
     it `BLOCKED` with valid provenance, and sets it **`ASSIGNED`** in the
     same transaction. Anything else → `40001`, nothing half-applied.
4. Events: the Blog's events carry `reviewTaskId`; the review gets
   `STATUS_CHANGED` + `TASK_BLOCKED` / `TASK_UNBLOCKED` with metadata
   `{sourceTaskId, coupledContentOsTransition: true, reason?}`.
5. The outer IF tests only `to_regprocedure`; all `content_os_*` calls are
   nested, so the function is safe before the Content OS schema exists and
   after its rollback (proven, dry-run section 5b).

Production order: A1 → A4 → Content OS drafts `00…06` → A2/A3 → wiring.

The superseded Sprint 9B reference body
(`docs/persistence/reference/transition_task_with_events.sprint9b.sql`,
non-coupled) was removed in Sprint 9C; it is in git history only.

## 4. Persisted lifecycle of the vertical slice

| Step | Task Bot (authoritative, one RPC call) | Content OS rows |
|---|---|---|
| Blog created | `content_os_create_task_idempotent('CREATE_TASK', 'blog:<requestKey>', hash, …)` → task IN_PROGRESS | `content_blogs` (deterministic id from the request key), `content_task_runtime` (pinned BLOG version, `source_task_id` = Research task if any), links PRIMARY BLOG + RELATED KNOWLEDGE_NODE |
| Blog completed | Blog `IN_PROGRESS → DONE` (assignee) | — |
| Head Review opened (once per Blog task) | `content_os_create_task_idempotent('CREATE_TASK', 'head-review:<blogTaskId>', …)` → IN_PROGRESS | runtime (pinned HEAD_REVIEW version, `source_task_id` = Blog task), links PRIMARY BLOG (same entity) + RELATED KNOWLEDGE_NODE |
| Revision requested | Blog `DONE → REVISION` (reviewer or Head) **and atomically** Head Review `IN_PROGRESS → BLOCKED`; `task_revisions` row | Head Review `field_values`: `review-decision = "Revision requested"`, `review-note` |
| Blog resubmitted | Blog `REVISION → DONE` (assignee) **and atomically** the SAME Head Review `BLOCKED → ASSIGNED` | `review-decision` cleared (`null`); note kept |
| Reviewer picks it up | Head Review `ASSIGNED → IN_PROGRESS` (legacy ACCEPT, by the review assignee) — done by `approve`/`requestRevision` | — |
| Approved | Head Review `IN_PROGRESS → DONE` (review assignee, only while the Blog is DONE) | `review-decision = "Approved"` (+ note) |

How BLOCKED → ASSIGNED is preserved: Content OS never moves the Head Review
for the revision/resubmission steps — it issues exactly **one** transition
on the Blog, and the Task Bot moves the coupled review in the same
transaction. So the review can never be left `IN_PROGRESS` while its Blog is
in REVISION, nor `BLOCKED` after the Blog is DONE again. The Sprint 9B
"stays IN_PROGRESS while waiting" model is withdrawn. Decision rules
(`lib/persistence/blog-review-flow.ts`): a decision is made by the active
Head Review assignee or the active Head; only the assignee completes the
review (the Task Bot's direct-DONE rule); the Blog author cannot decide.

## 5. Orchestration, retries and reconciliation

Service: `BlogReviewFlow` (`startBlog`, `completeBlog`, `requestRevision`,
`approve`, `reconcile`). Each operation reads current Task Bot state and
performs only what is still missing, so **every operation is safely
retryable** after any partial failure:

| Partial failure | Converges by |
|---|---|
| Blog transitioned, then a Content OS write (runtime/links) fails | retry `completeBlog`: Blog already DONE → no transition; Head Review creation returns the same task (idempotency key); runtime/links upserts are no-ops when present |
| Head Review creation response lost after the Task Bot created it | retry: `head-review:<blogTaskId>` with a hash over `{kind, blogTaskId, blogId}` only → same task even if the retry names another reviewer/deadline |
| Revision request retried | Blog already REVISION and review BLOCKED → treated as applied; only the decision fields are (re)aligned |
| Blog resubmitted twice | second call sees DONE/ASSIGNED → no transition; Task Bot itself also returns the task unchanged for a same-status transition |
| Link insert ignore-duplicates conflict | read-back requires each requested link to exist exactly; a swallowed PRIMARY conflict surfaces as `PersistenceConflictError`; nothing is created twice |
| Head Review state/decision write fails after the Blog transition | Task Bot state is already correct (atomic coupling); `reconcile(blogTaskId)` or any retry re-derives the decision fields |

`reconcile(blogTaskId)` is the single explicit reconciliation mechanism: it
derives the expected decision from Task Bot state (`DONE` → Approved;
`BLOCKED` + Blog `REVISION` → Revision requested; otherwise cleared), writes
only when it differs, and reports a missing Head Review for a DONE Blog as
an action (`HEAD_REVIEW_MISSING`) instead of creating one. Idempotent.

## 6. Server / client boundary

- `app/api/content-os/blog-review/route.ts` (POST, dynamic, `no-store`) is
  the only place that reads env (`resolveContentOsPersistenceConfig(process.env)`).
  Everything in `lib/persistence/` is env-free and Supabase-library-free
  (plain `fetch` injected).
- Config is explicit and fail-closed: disabled unless
  `CONTENT_OS_PERSISTENCE_ENABLED=true` with `CONTENT_OS_SUPABASE_URL`
  (https), `CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY`,
  `CONTENT_OS_IDENTITY_TENANT_KEY`; partial config → 503, nothing called.
  None of these is `NEXT_PUBLIC_*`; the client bundle has no reference to
  them (checked after build; test `blog-review-recovery`).
- The **actor is never taken from the request body** (strict schema rejects
  unknown keys). It is the platform-supplied SIWC subject (an **unsigned**
  header — see §10 for the trust contract this depends on) resolved via
  `external_identity_links` (`OPENAI_SIWC`, tenant key) to exactly one
  ACTIVE link of an ACTIVE `public.users` row; otherwise 401/403.
- Writes happen only server-side; the demo/session path (no persistence)
  is unchanged and remains the default. No component imports
  `lib/persistence`.
- Error mapping: rule/conflict → 409, Task Bot `42501` → 403, `40001` /
  `23505` / `23514` / `22023` / `55000` → 409, database API unreachable /
  timeout / gateway 5xx → 503 `PERSISTENCE_TRANSPORT_FAILURE`
  (`retryable: true`), unexpected → 500 without details.
- Request hygiene (Sprint 9D, §11): POST only, `application/json` only
  (415), body ≤ 16 KiB (413), cross-site / same-site browser requests
  refused (403, Fetch Metadata + Origin), no CORS grant, 10 s timeout per
  database API call.

## 7. Concurrency (`field_values` read-modify-write)

`mergeFieldValues` reads the runtime row and PATCHes the merged JSON, so two
concurrent merges on the same Head Review can lose one write. In this slice
that cannot cause a wrong transition: the decision fields are
informational and **never gate** anything — every gate uses Task Bot status,
events and provenance under row locks. Writers are serialized by the Task
Bot transitions they follow, and the only remaining race (a delayed write
from an earlier step landing after a later step's write) produces a stale
display value that `reconcile` re-derives. The revision note is also
persisted authoritatively in `task_revisions.reason` and the event metadata.
Decision: no fix in this slice; documented. A general fix (a
`jsonb ||`-merging RPC or optimistic `updated_at` check) is deferred until a
field becomes authoritative.

## 8. Deferred / limitations

- Live integration not performed: no Supabase apply, no deploy, no real
  credentials; proven only in-process (memory adapter simulating `a9ed78a`)
  and on disposable PostgreSQL 17.
- `external_identity_links` (draft 05) and its population are Task Bot /
  owner decisions (S8/S9); until linked, every request is 403.
- The posting checklist: Content OS never emits `#posting`
  (`neutralizePostingTag`); `startBlog` accepts only
  `postingChecklist: "NONE"` — a typed extension point for an explicit Task
  Bot creation parameter, not supported by today's RPC.
- No UI is wired to the route yet; notifications for the coupled review
  events are the Task Bot's.
- Other Head Review consumers (SEO/Angle/PC tasks) and the generic
  `field_values` concurrency fix are out of scope.

## 10. Identity trust contract (Sprint 9D audit) — release blocker

**Where the actor comes from.** `app/chatgpt-auth.ts` `getChatGPTUser()`
reads `oai-authenticated-user-id` (+ `-email`) from the incoming request.
Per the project README the hosting dispatcher ("Dispatch owns
`/signin-with-chatgpt`, `/callback`, the OAuth cookies, and identity header
injection") sets these headers after its own SIWC sign-in. In local dev the
vendored `build/sites-vite-plugin.ts` strips client-supplied
`oai-authenticated-user-*` headers and injects a mock user; `npm start` and
production have no such code in this repo.

**What the app verifies: nothing cryptographic.** The headers are plain
strings: no signature, no JWT, no issuer/audience/tenant claim. `OPENAI_SIWC`
and the tenant key are labels on `external_identity_links` rows, chosen by
Content OS config, not facts asserted by the request. Proven against the
built Worker: a direct request carrying `oai-authenticated-user-id:
siwc-head` acts as the Head (`tests/e2e/blog-review-route.e2e.mjs`,
"identity header is not verified by the app").

So the route is safe **only if** the platform guarantees, for every request
that can reach this Worker (including `/api/*`):

1. the dispatcher removes/overwrites any client-supplied
   `oai-authenticated-user-*` header before the Worker sees it;
2. the Worker has no other ingress (no `workers.dev` route, custom domain,
   service binding or preview URL that bypasses the dispatcher);
3. `oai-authenticated-user-id` is stable per user **per Site**, so the
   Site/project id is the correct `CONTENT_OS_IDENTITY_TENANT_KEY`;
4. which browser cookies authenticate the request and their `SameSite`
   policy (input to §11).

None of these is stated as a guarantee in this repo, and the app cannot
check them. Required before release: a written platform statement (or a
signed identity assertion the server can verify, e.g. a JWT with a
published key). No verification was invented here.

**External identity mapping (verified over real PostgREST + E2E).** Actor
resolution requires provider `OPENAI_SIWC` (also a CHECK on the table),
the configured tenant, exactly one `ACTIVE` link (partial unique index; a
`REVOKED` row never matches), an active `public.users` row, and exact
subject equality (case, whitespace and `*` do not match; reserved URL
characters are encoded correctly). Anonymous → 401; unknown, revoked,
other-tenant, inactive-user → 403; Head, reviewer, author resolve; no body
field selects the actor (strict schema → 400).

## 11. Request security, logging, and the 40001 hazard (Sprint 9D)

**CSRF.** Identity rides on ambient platform cookies, so a third-party page
could make a signed-in browser POST here. Defenses that match this model:
`application/json` only (a cross-origin JSON POST needs a CORS preflight,
which the route never grants), `Sec-Fetch-Site` must be `same-origin` /
absent (`same-site` is refused too: other Sites may share the parent
domain), and a present `Origin` must equal the request host. Non-browser
clients send no Fetch Metadata and still need the platform identity.

**Logging.** One JSON line per request (`event: content_os.blog_review`)
with `action`, `outcome` (`ok`, `not_configured`, `unauthenticated`,
`invalid_input`, `actor_not_linked`, `content_os_rule`,
`content_os_conflict`, `task_bot_rejected` + `sqlState`,
`transport_failure`, `internal_error`), HTTP status, code, the resolved
internal `actorId`, and idempotency results (`created`,
`headReviewCreated`, `reconcileActions`). Never: headers, key, external
subject, request body. Verified in the Worker's real output.

**HAZARD — Task Bot owned, not fixed here.** The Task Bot reports refused
transitions (and several other business refusals) as SQLSTATE `40001`.
PostgREST 11.2.2, 12.0.3, 12.2.3 and 13.0.0 (all tested locally) treat
`40001` as a serialization failure and **retry the transaction without
limit**: the HTTP request never answers, the loop continues after the
client disconnects (> 2,000 rollbacks/s observed), and each such request
pins a PostgREST pool connection. The Task Bot itself calls
`transition_task_with_events` through supabase-js, i.e. PostgREST. Content
OS mitigation (this sprint): every Task Bot transition is pre-validated
with the same rules and only sent when it will be accepted, plus a 10 s
client timeout. Residual: a genuine race between two different decisions
(e.g. approve vs. revision at the same moment) can still trigger it.
Owner action: use a non-retryable SQLSTATE for business refusals (e.g.
`P0001`/custom class) and confirm the live PostgREST version's behaviour
(read-only), before releasing any caller that can send refusable
transitions.

**PostgREST compatibility (verified against real PostgREST 12.2.3 via a
local Supabase-gateway emulator).** `/rest/v1` prefix, `apikey` +
`Authorization: Bearer` with a JWT-format `service_role` key (anon key →
401 / `42501`), JSON bodies, `Prefer: resolution=ignore-duplicates,
return=minimal` (targets the PRIMARY KEY, so the partial one-PRIMARY index
raises `23505` → 409; same-key/different-relation is caught by the
read-back), RPC argument names, `returns table` and composite results,
UUID / `timestamptz` / JSONB round-trips, empty results → null, write-once
provenance (`55000`), idempotency-key reuse (`23505` → 409). Not verified:
Supabase's newer non-JWT `sb_secret_…` keys (the adapter sends the key as
both `apikey` and Bearer, which matches the legacy JWT keys).

**S6 (legacy hierarchy).** The slice reads a Knowledge Node by id and never
uses its parent part, so it does not depend on the S6 answer. It does
require Knowledge Node rows to exist in production (B1 apply + a
population path; the Sheet import B7 waits for S6).

## 12. Evidence

`supabase/content-os-drafts/dry-run/run-dry-run.sh` on disposable
PostgreSQL 17.11 (`DRY_RUN_EVIDENCE.log`): Sprint 8 contract suite +
`25_transition_contract_tests.sql` pass on two fresh databases; Codex's final
function (read via `git show`, md5 recorded in the log) passes
`40_task_bot_transition_tests.sql` as real transitions, including the
coupled `BLOCKED`/`ASSIGNED` lifecycle, the REVIEW→DONE gate and
all-or-nothing resubmission (section 5b); Task Bot fingerprint unchanged;
privilege stripping verified; rollback removes all Content OS objects incl.
the 06 functions. Unit tests: `tests/blog-review-lineage.test.mjs`,
`tests/blog-review-recovery.test.mjs`, `tests/persistence-adapter.test.mjs`.
Sprint 9D, local only (`npm run test:e2e:setup && npm run build && npm run
test:e2e`): `tests/e2e/postgrest-adapter.e2e.mjs` (real PostgREST) and
`tests/e2e/blog-review-route.e2e.mjs` (the built Worker under local
workerd → TLS gateway emulator → PostgREST 12.2.3 → PostgreSQL 17 with the
final Task Bot migrations at `a9ed78a` + drafts 00..06).
