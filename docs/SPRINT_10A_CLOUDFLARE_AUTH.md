# Sprint 10A — Cloudflare production authentication

## Decision

Content OS production targets one standalone Cloudflare Worker. V1 may use its Cloudflare-provided `workers.dev` hostname. ChatGPT Sites is preview/demo-only and provides no production identity or trust guarantee.

The existing Telegram Task Bot is the only V1 login provider. `public.users` is the identity, active-state, and role authority. Entry is limited by the Task Bot RPC to active users whose current role is one of:

- `HEAD_OF_MARKETING`
- `CONTENT_MARKETER`
- `DIGITAL_MARKETER`
- `SMM_MANAGER`
- `SEO_SPECIALIST`
- `OPERATOR_VIDEO_EDITOR`

Task Bot remains the sole canonical database-migration owner. Content OS must never replay its historical migration copies against production.

## Login sequence

1. The browser generates 32 cryptographically random bytes as a verifier and computes SHA-256 in the browser.
2. `POST /api/auth/telegram/start` sends only the 64-character proof. The server calls `content_os_auth_create_challenge`.
3. The response contains a random challenge UUID, its expiry, and a deep link to the existing bot. The link contains only `contentos_<challenge-id>`.
4. The genuine Telegram update identifies the Telegram user. The bot requires an explicit **Content OS ga kirishni tasdiqlash** action and calls `content_os_auth_approve_challenge`; unknown, pending, or inactive users receive the same generic refusal.
5. The browser polls `GET /api/auth/telegram/status` with bounded backoff, stopping at the challenge expiry or after ten minutes.
6. Once approved, `POST /api/auth/telegram/complete` sends the challenge UUID and original verifier. The Worker hashes the verifier, generates a separate opaque session token, hashes that token, and atomically redeems the challenge with `content_os_auth_redeem_challenge`.
7. The raw session token exists only in the `HttpOnly` cookie. The database stores only its SHA-256 hash. A challenge can be redeemed once; concurrent/replayed redemption cannot create another session.

The raw verifier is kept temporarily in browser `sessionStorage` and removed after success or a terminal status. It is never sent to Telegram or stored in PostgreSQL.

## Session and request boundary

Cookie name: `content_os_session`.

- opaque random token only
- `HttpOnly`
- `SameSite=Strict`
- `Path=/`
- `Max-Age=2592000` (exactly 30 days)
- `Secure` on HTTPS, including production

Every protected request hashes the cookie and calls `content_os_auth_validate_session`. That RPC joins the current `public.users` row, requires `is_active`, and returns the current role. Role is not frozen into a cookie or long-lived client token. Deactivation revokes existing sessions immediately; reactivation does not revive them. Multiple devices have independent sessions, and logout revokes only the presented session through `content_os_auth_revoke_session`.

Invalid/missing/expired/revoked sessions return `401`. Authentication-backend failure returns `503` and no application mutation is executed. Broader role permissions are deferred to Sprint 10B.

State-changing routes require all of: an authenticated session, exact `Host`, matching `Origin`, `Sec-Fetch-Site` of `same-origin`/`none` when present, `application/json`, a bounded body, and an allowed method. The Worker does not grant CORS. Origin is a CSRF signal, never identity.

Public routes:

- `GET /login`
- `POST /api/auth/telegram/start`
- `GET /api/auth/telegram/status`
- `POST /api/auth/telegram/complete`

Authenticated routes:

- `POST /api/auth/logout`
- `GET /api/auth/me`
- `/` and every Content OS application page
- all existing data and mutation APIs, including `POST /api/content-os/blog-review`

The Blog review route takes its actor only from the validated session. Strict request schemas reject body-supplied `actorId` values.

## Cloudflare Worker

The source configuration is `wrangler.jsonc`: `vinext/server/fetch-handler`, compatibility date `2026-10-06` (the newest release accepted by the repository's seven-day package-maturity policy), `nodejs_compat`, static assets, workers.dev/preview URLs, and Worker observability. `vite.config.ts` reads that explicit config and contains no Sites plugin or `.openai/hosting.json` binding dependency.

Local development:

```sh
cp .env.example .dev.vars
pnpm dev
pnpm build
pnpm start
```

Use throwaway local values only. `.dev.vars`, `.env*`, `.wrangler/`, and generated build output must remain untracked.

Production bindings are added to the Worker, not committed:

```sh
pnpm wrangler secret put CONTENT_OS_SUPABASE_URL
pnpm wrangler secret put CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY
pnpm wrangler secret put GOOGLE_PRIVATE_KEY
```

Set `CONTENT_OS_TELEGRAM_BOT_USERNAME`, `CONTENT_OS_PERSISTENCE_ENABLED=true`, and non-secret Google configuration as Worker variables in the approved production environment. Never expose the service-role key through `NEXT_PUBLIC_*`, client props, HTML, logs, or source maps.

These commands document future operator work; Sprint 10A does not execute them and does not deploy.

## Disposable integration rehearsal

`tests/e2e/setup.sh` creates a fresh local database from the canonical Task Bot migrations only, seeds non-production fixtures, and starts local PostgREST. It does not apply the duplicate Content OS draft files. After `pnpm build`, `pnpm test:e2e` runs the built Worker under local Wrangler/workerd through a TLS gateway and real PostgREST/PostgreSQL 17.

The rehearsal proves:

- browser challenge → canonical bot approval RPC → status → verifier redemption → cookie → protected request → logout
- unknown/inactive denial, wrong verifier, one-time redemption, and no duplicate session
- current role on the next request
- deactivation denies the next request and reactivation does not restore the old session
- two independent device sessions and one-device logout
- persisted Blog → Head Review → revision → resubmit to the same Head Review → approval
- idempotent retries do not duplicate tasks/history
- forged Sites identity headers do not authenticate
- client build contains no service-role value, database URL, raw verifier, session token/hash, or bot token

## Deployment preconditions

No deployment is authorized by this document. Before a future production deploy, a human release owner must confirm all of the following:

- exact clean Task Bot and Content OS release SHAs
- the canonical Sprint 10A Task Bot migration applied with the normal approved Supabase CLI flow and its final ledger verified
- the existing Telegram bot code at the matching Task Bot SHA is running
- Worker bindings/secrets exist in the intended Cloudflare environment and no production secret was used in CI artifacts
- the complete PostgreSQL 17/PostgREST/Worker rehearsal and all unit, lint, typecheck, build, and secret scans pass at those SHAs
- backup/PITR and rollback/fix-forward plan approved
- explicit human authorization changes `PRODUCTION_RELEASE` from `HOLD`

Until then: `PUSH = NO`, `DEPLOY = NO`, `LIVE APPLY = NO`, `PRODUCTION_RELEASE = HOLD`.
