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
- `dry-run/DRY_RUN_EVIDENCE.log` — output of the last run.

Why they are not under `supabase/migrations/`: this repo has no Supabase
project of its own, and the task-bot track (Codex) owns the production
schema. Before any production apply: run `docs/persistence/live-catalog-audit.sql`
read-only against the live project, resolve the open decisions in
`docs/persistence/SPRINT_8A_PERSISTENCE_CONTRACT.md` §S, and get task-bot
owner review. `external_identity_links` may move to the task-bot repo.
