# Sprint 11B — Content OS Cloudflare staging release manifest

For the staging orchestrator (Codex). Local preparation only: nothing here has
been deployed, no Cloudflare or Supabase call was made, and production stays
on HOLD. Branch `staging-prep/sprint-11b-content-os-cloudflare`, based on the
frozen candidate `746b45633d45ddb43068d04380a86a7baa223855`.

## 1. Why the frozen candidate needed changes

| Finding | Effect on staging | Change |
|---|---|---|
| Deploying with `--config wrangler.staging.local.jsonc` (Sprint 11A handoff) fails: wrangler cannot find the entry point `vinext/server/fetch-handler`; the tested artifact is the Vite build in `dist/server` with a generated `wrangler.json`. | No staging deploy could succeed that way. | `wrangler.jsonc` `env.staging`; build with `CLOUDFLARE_ENV=staging`; deploy the generated config. |
| The generated config always used production's name and limiter namespace `1001`; `--name` alone does not change the namespace. | Staging would share production's login rate-limit counters. | `env.staging` declares its own `LOGIN_START_LIMITER` namespace 1101 (owner-selected, §5). |
| Nothing tied a deployment to one Supabase project. | A staging Worker given the production URL would use it. | `CONTENT_OS_DEPLOYMENT_ENV=staging` + `CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF=yuznbaaoonyqonhiywkt` pinned in `env.staging`; any other Supabase URL fails closed (503). |
| `TASK_BACKEND_BASE_URL` with a trailing slash or path produced a signed path different from the sent path (signature mismatch, 401). | Fragile Task Bot integration. | The base URL is normalized to its origin; a path/query/credentials are rejected. |
| Content OS offered a non-assigned Head "Request revision" on an ASSIGNED review and picked it up as Head; the frozen Task Bot (`3bd2ca7`) refuses that. | 403 in staging acceptance. | Supervisory revision only once the reviewer picked the review up (`ac57fe9`). |

## 2. Worker

| Item | Value |
|---|---|
| Worker | `ibox-content-os-staging` (top-level `ibox-content-os` + env `staging`) |
| Hostname | `https://ibox-content-os-staging.lively-river-afba.workers.dev` only (Worker already exists; currently a 503 placeholder) |
| `workers_dev` / `preview_urls` | `true` / `false` |
| Routes / custom domains | none |
| Compatibility | `2026-10-06`, `nodejs_compat` |
| Observability | enabled (logs + invocation logs) |
| Assets binding | `ASSETS` → `dist/client` |
| Rate-limit binding | `LOGIN_START_LIMITER`, 5 / 60 s, namespace **1101** (owner-selected; production keeps 1001) |
| Plain vars (in `wrangler.jsonc`) | `CONTENT_OS_DEPLOYMENT_ENV=staging`, `CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF=yuznbaaoonyqonhiywkt` |

## 3. Runtime bindings read by the current code

| Binding | Read by | Class | Staging |
|---|---|---|---|
| `CONTENT_OS_SUPABASE_URL` | auth, persistence, workflow classifier | Supabase value (plain) | **Required**: exactly `https://yuznbaaoonyqonhiywkt.supabase.co` |
| `CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY` | same | **Secret** (Supabase) | **Required**: staging project's service-role key |
| `CONTENT_OS_TELEGRAM_BOT_USERNAME` | login deep link `t.me/<bot>?start=contentos_<challenge>` | Plain config | **Required**: the staging bot |
| `CONTENT_OS_RATE_LIMIT_PEPPER` | login rate key (`lib/auth/rate-key.ts`, `cloudflare:workers` env) | **Secret** | **Required**, ≥ 32 chars — **already provisioned** on the staging Worker |
| `CONTENT_OS_PERSISTENCE_ENABLED` | Blog review API | Plain config | **Required**: `true` |
| `TASK_BACKEND_SERVICE_AUTH_ENABLED` | team-task client | Plain config | **Required**: `true` |
| `TASK_BACKEND_BASE_URL` | team-task client | Task Bot value (plain) | **Required**: exactly `https://ibox-task-bot-staging.lively-river-afba.workers.dev` (bare origin, no trailing path) |
| `CONTENT_OS_TASK_BACKEND_SECRET` | request signing | **Secret** | **Required**: same value as the staging Task Bot's `CONTENT_OS_SERVICE_SECRET` — **already provisioned** on the staging Worker |
| `CONTENT_OS_DEPLOYMENT_ENV`, `CONTENT_OS_EXPECTED_SUPABASE_PROJECT_REF` | deployment-target guard | Generated staging-only plain vars | From `wrangler.jsonc`; must NOT be set as secrets |
| `LOGIN_START_LIMITER`, `ASSETS` | login start, static assets | Bindings | From `wrangler.jsonc` |
| `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (secret), `DATA_SOURCE` | legacy Sheets routes (`/api/knowledge`, `/api/production`, `/api/catalog-preview`) | Deprecated / out of staging scope | Leave unset (those routes then answer 503) |
| `DB` (D1) | `db/index.ts`, imported by no route | Deprecated (Sites scaffold) | Not bound |
| `TASK_BACKEND_SESSION_COOKIE` | `lib/task-client-http-config.ts` (not wired to any route) | Test-only / deprecated | Must not be set |
| `CONTENT_OS_IDENTITY_TRUST`, `CONTENT_OS_IDENTITY_TENANT_KEY` | nothing (removed in 10A/10D) | Deprecated | Must not be set |

Content OS never uses a Telegram bot token, a database connection string or
any `NEXT_PUBLIC_*` value.

## 4. Fail-closed behaviour

- Missing/partial auth config, a Supabase URL other than the pinned staging
  project, a missing deployment pin, or a missing service-auth config → 503
  (`AUTH_BACKEND_UNAVAILABLE` / `TASK_BACKEND_NOT_CONFIGURED` /
  `CONTENT_OS_PERSISTENCE_CONFIG_ERROR`). Proven on the built staging Worker
  given the production URL (`tests/e2e/staging-worker.e2e.mjs`).
- Login start without the pepper or without Cloudflare's `CF-Connecting-IP`
  over https → 503; without the edge limiter binding → 503.
- Session cookie: `__Host-content_os_session` (Secure, HttpOnly, `Path=/`, no
  Domain, `SameSite=Strict`) on https; no cookie on any non-loopback http.

## 5. External staging facts (recorded Sprint 11B-B2)

| Fact | Value |
|---|---|
| Content OS staging Worker | `ibox-content-os-staging`, origin `https://ibox-content-os-staging.lively-river-afba.workers.dev`, Preview URLs off |
| Task Bot staging origin (`TASK_BACKEND_BASE_URL`) | `https://ibox-task-bot-staging.lively-river-afba.workers.dev` |
| Supabase staging project | `yuznbaaoonyqonhiywkt` |
| Secrets already on the staging Worker | `CONTENT_OS_RATE_LIMIT_PEPPER`, `CONTENT_OS_TASK_BACKEND_SECRET` (values never in this repository) |
| Staging rate-limit namespace | `1101` (owner-selected); production `1001` unchanged |

Because `--secrets-file` uploads additively, the operator's secrets file must
still contain every Required binding of §3 for the preflight; the two
already-provisioned secrets may be re-supplied with their existing values.

## 6. Deploy commands (staging only; execute only in the approved run)

```sh
# exact, clean candidate (after the namespace commit)
test -z "$(git status --porcelain)"
git rev-parse HEAD            # record and compare with the approved SHA

npm run build:staging         # CLOUDFLARE_ENV=staging vinext build
node scripts/staging-preflight.mjs --secrets-file "$STAGING_CF_SECRETS_FILE"
#   must end with: STAGING PREFLIGHT PASSED   (prints check names only, never values)

# Deploy the GENERATED config (wrangler follows .wrangler/deploy/config.json to
# dist/server/wrangler.json). Do NOT pass --config, --name or --env.
npx wrangler deploy --dry-run
npx wrangler deploy --secrets-file "$STAGING_CF_SECRETS_FILE" --keep-vars --strict
npx wrangler tail ibox-content-os-staging
```

`$STAGING_CF_SECRETS_FILE` (mode 600, outside the repository) holds exactly
the eight bindings of §3 marked Required. After deploy, verify in the
dashboard that only the `workers.dev` hostname exists and Preview URLs are off.

## 7. Login flow readiness (no live login performed)

Browser `POST /api/auth/telegram/start` (same-origin JSON, server-derived
HMAC rate key) → Task Bot `content_os_auth_create_challenge(p_verifier_hash,
p_rate_key_hash)` returns the challenge and `display_code` → browser shows
`Kod: XXX XXX` and opens `t.me/<staging bot>?start=contentos_<challenge>` →
staging bot shows the same code and the user approves → browser polls
`content_os_auth_get_challenge_status` → `POST /api/auth/telegram/complete`
redeems with the browser-held verifier → `__Host-content_os_session`.
The RPC names and argument lists match Task Bot `3bd2ca7`.

## 8. Verification (local)

629 unit tests; lint; typecheck; production build and staging build; built
Worker tests (`login-worker.e2e.mjs` on the production-shape build,
`staging-worker.e2e.mjs` on the staging build); client-bundle secret scan
(0 hits for the pepper, service-role, task-backend secret, token/verifier
hashes, connection strings, `NEXT_PUBLIC_`, Sites identity, either Supabase
project ref, `cf-connecting-ip`); `git diff --check`.
