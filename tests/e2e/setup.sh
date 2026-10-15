#!/usr/bin/env bash
# LOCAL E2E ONLY. Builds a disposable database in the local Docker container
# (default ibox-pg-dryrun, postgres:17) from the FINAL canonical Task Bot
# migrations (read-only worktree, default ../marketing-team-task-bot-sprint9b),
# then starts a real PostgREST (container
# ibox-postgrest) in the database container's network namespace. Never point
# this at Supabase. All credentials here are throwaway local values.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../.."
export PG_CONTAINER="${PG_CONTAINER:-ibox-pg-dryrun}"
export BOT_MIGRATIONS="${BOT_MIGRATIONS:-$(cd "$ROOT/../marketing-team-task-bot-sprint9b/supabase/migrations" && pwd)}"
DB="${E2E_DB:-e2e}"
echo "task bot migrations: $BOT_MIGRATIONS ($(git -C "$BOT_MIGRATIONS" rev-parse --short HEAD))"
"$ROOT/supabase/content-os-drafts/dry-run/load-taskbot-baseline.sh" "$DB" > /dev/null
docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q -X -d "$DB" < "$HERE/seed.sql"
docker rm -f ibox-postgrest > /dev/null 2>&1 || true
docker run -d --name ibox-postgrest --network "container:$PG_CONTAINER" \
  -e PGRST_DB_URI="postgres://authenticator:e2e-local-only@127.0.0.1:5432/$DB" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_SERVER_PORT=3000 \
  -e PGRST_JWT_SECRET="local-e2e-jwt-secret-not-a-real-secret-0123456789" \
  postgrest/postgrest:v12.2.3 > /dev/null
IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$PG_CONTAINER")"
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://$IP:3000/" || true)"
  [ "$code" = 200 ] && break; sleep 1
done
echo "PGRST_UPSTREAM=http://$IP:3000"
