#!/usr/bin/env bash
# Sprint 8B LOCAL DRY-RUN. Disposable PostgreSQL 17 in Docker only.
# Never point this at Supabase: it creates and drops databases.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DRAFTS="$HERE/../migrations"
DOWN="$HERE/../rollback/content_os_99_down.sql"
CONTAINER="${PG_CONTAINER:-ibox-pg-dryrun}"
export PG_CONTAINER="$CONTAINER"
BOT_REPO="$(cd "$HERE/../../../../marketing-team-task-bot" && pwd)"
sql() { docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
fingerprint() { sql -d "$1" -tA < "$HERE/10_taskbot_fingerprint.sql"; }
apply_drafts() {
  for f in "$DRAFTS"/*.sql; do
    echo "  apply draft $(basename "$f")"
    sql -d "$1" --single-transaction < "$f"
  done
}
section() { echo; echo "=== $*"; }

section "environment"
docker exec "$CONTAINER" psql -U postgres -tAc "select version()"
echo "task-bot repo HEAD: $(git -C "$BOT_REPO" rev-parse --short HEAD), dirty files: $(git -C "$BOT_REPO" status --porcelain | wc -l)"
BOT_MIGRATIONS_MD5_BEFORE="$(cat "$BOT_REPO"/supabase/migrations/*.sql | md5sum | cut -d' ' -f1)"
echo "task-bot migrations md5: $BOT_MIGRATIONS_MD5_BEFORE"

section "1. fresh apply on the task-bot baseline (db dryrun_a)"
"$HERE/load-taskbot-baseline.sh" dryrun_a
FP_BASE="$(fingerprint dryrun_a)"
echo "task-bot fingerprint before drafts: $FP_BASE"
apply_drafts dryrun_a
FP_AFTER="$(fingerprint dryrun_a)"
echo "task-bot fingerprint after drafts:  $FP_AFTER"
[ "$FP_BASE" = "$FP_AFTER" ] || { echo "FAIL task-bot objects changed"; exit 1; }
echo "PASS T01 task-bot catalog objects unchanged by the drafts"
echo "content tables created: $(sql -d dryrun_a -tAc "select count(*) from pg_tables where schemaname = 'public' and (tablename like 'content%' or tablename = 'external_identity_links')")"

section "2. contract tests (constraints, FKs, uniqueness, versioning, lineage, idempotency, identity, grants)"
sql -d dryrun_a -f - < "$HERE/20_contract_tests.sql" 2>&1 | grep -E 'PASS|FAIL|ERROR|ALL CONTRACT' | sed -E 's/^psql:[^ ]* (NOTICE|ERROR):  //'

section "3. concurrency: 12 parallel idempotent creates with the SAME key"
CALL="select task_id from public.content_os_create_task_idempotent('CREATE_TASK', 'race-key-1', repeat('9', 64),
  (select v from dryrun.ids where k = 'head'), (select v from dryrun.ids where k = 'cm'), 'Race task', '', 'normal', now() + interval '1 day')"
pids=()
for i in $(seq 1 12); do
  docker exec "$CONTAINER" psql -U postgres -d dryrun_a -X -tAc "$CALL" > "/tmp/race.$i" 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
DISTINCT="$(cat /tmp/race.* | sort -u | wc -l)"; rm -f /tmp/race.*
TASKS="$(sql -d dryrun_a -tAc "select count(*) from public.tasks where title = 'Race task'")"
KEYS="$(sql -d dryrun_a -tAc "select count(*) from public.content_os_idempotency_keys where idempotency_key = 'race-key-1'")"
echo "distinct task ids returned: $DISTINCT, tasks created: $TASKS, ledger rows: $KEYS"
[ "$DISTINCT" = 1 ] && [ "$TASKS" = 1 ] && [ "$KEYS" = 1 ] || { echo "FAIL concurrent duplicate"; exit 1; }
echo "PASS T14 concurrent same-key calls create exactly one task"

section "4. rollback on a database WITH data, then recreate"
sql -d dryrun_a --single-transaction < "$DOWN"
FP_ROLLED="$(fingerprint dryrun_a)"
LEFT="$(sql -d dryrun_a -tAc "select count(*) from pg_class where relnamespace = 'public'::regnamespace and (relname like 'content%' or relname like 'external_identity%')")"
LEFT_FN="$(sql -d dryrun_a -tAc "select count(*) from pg_proc where proname like 'content_os%'")"
echo "after rollback: content relations left: $LEFT, content functions left: $LEFT_FN, fingerprint: $FP_ROLLED"
[ "$LEFT" = 0 ] && [ "$LEFT_FN" = 0 ] && [ "$FP_ROLLED" = "$FP_BASE" ] || { echo "FAIL rollback"; exit 1; }
TASKS_AFTER="$(sql -d dryrun_a -tAc "select count(*) from public.tasks")"
echo "operational tasks kept after rollback: $TASKS_AFTER (Content OS-created tasks stay ordinary tasks)"
echo "PASS rollback removes every Content OS object and leaves the task-bot catalog identical"
apply_drafts dryrun_a
[ "$(fingerprint dryrun_a)" = "$FP_BASE" ] || { echo "FAIL recreate changed task-bot objects"; exit 1; }
echo "PASS recreate after rollback (same database, existing operational data)"

section "5. second independent fresh apply + full test run (db dryrun_b)"
"$HERE/load-taskbot-baseline.sh" dryrun_b > /dev/null
apply_drafts dryrun_b > /dev/null
OUT_B="$(sql -d dryrun_b -f - < "$HERE/20_contract_tests.sql" 2>&1)"
echo "PASS lines on dryrun_b: $(grep -c 'PASS ' <<< "$OUT_B"), FAIL/ERROR lines: $(grep -cE 'FAIL|ERROR' <<< "$OUT_B" || true)"
grep -q 'ALL CONTRACT TESTS PASSED' <<< "$OUT_B" || { echo "FAIL contract tests on dryrun_b"; exit 1; }

section "6. task-bot repo untouched"
BOT_MIGRATIONS_MD5_AFTER="$(cat "$BOT_REPO"/supabase/migrations/*.sql | md5sum | cut -d' ' -f1)"
echo "task-bot migrations md5 after: $BOT_MIGRATIONS_MD5_AFTER, dirty files: $(git -C "$BOT_REPO" status --porcelain | wc -l)"
[ "$BOT_MIGRATIONS_MD5_BEFORE" = "$BOT_MIGRATIONS_MD5_AFTER" ] || { echo "FAIL task-bot migrations changed"; exit 1; }
echo "PASS task-bot migrations byte-identical"

echo; echo "DRY-RUN COMPLETE"
