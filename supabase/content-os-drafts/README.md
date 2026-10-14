# Content OS persistence — DRAFT migrations (Sprint 8B)

**Not applied to production. Not applied to any Supabase project.** These
files exist only to be dry-run on a disposable local PostgreSQL 17.

- `migrations/` — additive drafts, run strictly after the 8 task-bot
  migrations. They add no column to any task-bot table and call (never
  change) `create_task_with_event_v2`.
- `rollback/content_os_99_down.sql` — drops every Content OS object.
- `dry-run/run-dry-run.sh` — builds a throwaway database from
  `../marketing-team-task-bot/supabase/migrations` (read-only), applies the
  drafts, runs `20_contract_tests.sql`, a 12-way concurrency race, rollback +
  recreate, and a second fresh apply. Requires Docker and a container named
  by `PG_CONTAINER` (default `ibox-pg-dryrun`) running `postgres:17`.
- `dry-run/25_transition_contract_tests.sql` — Sprint 9B transition contract
  (migration 06): Blog / Head Review provenance, reviewer authorization,
  pinned review-required, fail-safe malformed config.
- `dry-run/40_reference_transition_tests.sql` — proves the reference Task Bot
  function in `docs/persistence/reference/` as real transitions.
- `dry-run/DRY_RUN_EVIDENCE.log` — output of the last run.

Why they are not under `supabase/migrations/`: this repo has no Supabase
project of its own, and the task-bot track (Codex) owns the production
schema. `external_identity_links` may move to the task-bot repo.

Status at Sprint 8 close (`docs/persistence/SPRINT_8A_PERSISTENCE_CONTRACT.md`
§T, §U): live structural parity **PASS** (read-only audit, 2026-10-14);
draft safety **PASS** (incl. the `fe2b6e6` privilege hardening); production
apply **HOLD** until the Track A task-bot compatibility changes are
implemented and reviewed, the task-bot owner has reviewed the existing
`service_role` privilege gap, and the migration owner approves these drafts.
Plan: `docs/persistence/SPRINT_9_TASK_BOT_INTEGRATION_PLAN.md`.
