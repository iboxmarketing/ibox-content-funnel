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
echo "--- Sprint 9B transition contract (06)"
sql -d dryrun_a -f - < "$HERE/25_transition_contract_tests.sql" 2>&1 | grep -E 'PASS|FAIL|ERROR|ALL TRANSITION' | sed -E 's/^psql:[^ ]* (NOTICE|ERROR):  //'

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
OUT_B="$(sql -d dryrun_b -f - < "$HERE/20_contract_tests.sql" 2>&1; sql -d dryrun_b -f - < "$HERE/25_transition_contract_tests.sql" 2>&1)"
echo "PASS lines on dryrun_b: $(grep -c 'PASS ' <<< "$OUT_B"), FAIL/ERROR lines: $(grep -cE 'FAIL|ERROR' <<< "$OUT_B" || true)"
grep -q 'ALL CONTRACT TESTS PASSED' <<< "$OUT_B" && grep -q 'ALL TRANSITION CONTRACT TESTS PASSED' <<< "$OUT_B" || { echo "FAIL contract tests on dryrun_b"; grep -E 'FAIL|ERROR' <<< "$OUT_B"; exit 1; }

section "5b. FINAL Task Bot transition function (Codex, read-only via git show) against drafts 00..06 (db dryrun_c)"
TB_FINAL_REF="${TB_FINAL_REF:-codex/sprint-9b-hardening}"
TB_FINAL_FILE="supabase/migrations/20261014130332_content_os_task_transition_compatibility.sql"
TB_FN="$(mktemp)"; trap 'rm -f "$TB_FN"' EXIT
if ! git -C "$BOT_REPO" show "$TB_FINAL_REF:$TB_FINAL_FILE" > "$TB_FN" 2>/dev/null; then
  echo "SKIPPED 5b: $TB_FINAL_REF:$TB_FINAL_FILE is not available in $BOT_REPO (coupled lifecycle NOT proven by this run)"
else
echo "Task Bot function: $TB_FINAL_REF @ $(git -C "$BOT_REPO" rev-parse --short "$TB_FINAL_REF") $TB_FINAL_FILE (md5 $(md5sum < "$TB_FN" | cut -d' ' -f1))"
"$HERE/load-taskbot-baseline.sh" dryrun_c > /dev/null
sql -d dryrun_c --single-transaction < "$TB_FN"
LEGACY_NO_CO="$(sql -d dryrun_c -tA -c "insert into public.users (telegram_user_id, display_name, role, is_active) values (3999, 'h', 'DIGITAL_MARKETER', true), (3998, 'a', 'CONTENT_MARKETER', true);
  with t as (select id from public.create_task_with_event_v2((select id from public.users where telegram_user_id = 3999), (select id from public.users where telegram_user_id = 3998), 'legacy before CO', '', 'normal', now() + interval '1 day'))
  select (select status from public.transition_task_with_events((select id from t), (select id from public.users where telegram_user_id = 3998), 'REVIEW'))" 2>&1 | tail -1)"
[ "$LEGACY_NO_CO" = "REVIEW" ] || { echo "FAIL Task Bot function without Content OS schema: $LEGACY_NO_CO"; exit 1; }
echo "PASS Task Bot function before the Content OS schema: legacy transitions work (no content_os_* function is planned)"
apply_drafts dryrun_c > /dev/null
OUT_C="$(sql -d dryrun_c -f - < "$HERE/40_task_bot_transition_tests.sql" 2>&1)"
grep -E 'PASS|FAIL|ERROR' <<< "$OUT_C" | sed -E 's/^(psql:[^ ]* )?(NOTICE|ERROR):  //'
grep -q 'ALL TASK BOT TRANSITION TESTS PASSED' <<< "$OUT_C" || { echo "FAIL Task Bot transition tests"; exit 1; }
sql -d dryrun_c --single-transaction < "$DOWN"
AFTER_RB="$(sql -d dryrun_c -tA -c "select status from public.transition_task_with_events((select v from ref.ids where k = 'research'), (select v from ref.ids where k = 'head'), 'ASSIGNED')" 2>&1 | tail -1)"
[ "$AFTER_RB" = "ASSIGNED" ] || { echo "FAIL legacy transition after Content OS rollback: $AFTER_RB"; exit 1; }
echo "PASS after Content OS rollback the Task Bot function still runs legacy transitions (REOPEN DONE -> ASSIGNED)"
fi

section "6. task-bot repo untouched"
BOT_MIGRATIONS_MD5_AFTER="$(cat "$BOT_REPO"/supabase/migrations/*.sql | md5sum | cut -d' ' -f1)"
echo "task-bot migrations md5 after: $BOT_MIGRATIONS_MD5_AFTER, dirty files: $(git -C "$BOT_REPO" status --porcelain | wc -l)"
[ "$BOT_MIGRATIONS_MD5_BEFORE" = "$BOT_MIGRATIONS_MD5_AFTER" ] || { echo "FAIL task-bot migrations changed"; exit 1; }
echo "PASS task-bot migrations byte-identical"

echo; echo "DRY-RUN COMPLETE"
