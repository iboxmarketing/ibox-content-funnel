#!/usr/bin/env bash
# LOCAL DRY-RUN ONLY: builds a fresh database from the task-bot repo's
# migrations (read from the sibling checkout, never modified) so Content OS
# drafts can be tested on top of the exact repo-defined baseline.
set -euo pipefail
DB="${1:?database name}"
CONTAINER="${PG_CONTAINER:-ibox-pg-audit}"
BOT_MIGRATIONS="${BOT_MIGRATIONS:-$(cd "$(dirname "$0")/../../../../marketing-team-task-bot/supabase/migrations" && pwd)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
psql_db() { docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q -d "$1"; }
docker exec "$CONTAINER" psql -U postgres -q -c "drop database if exists $DB with (force)" -c "create database $DB"
psql_db "$DB" < "$HERE/00_supabase_roles_bootstrap.sql"
for f in "$BOT_MIGRATIONS"/*.sql; do
  echo "apply task-bot $(basename "$f")"
  psql_db "$DB" < "$f"
done
