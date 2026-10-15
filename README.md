# IBOX Content OS

IBOX Content OS is a Vinext/Next.js application built for a standalone Cloudflare Worker. The V1 production hostname may use `workers.dev`; a custom domain is deferred.

Production authentication uses the existing Telegram Task Bot and the canonical Task Bot database RPCs. It does not trust OpenAI Sites identity headers, `OPENAI_SIWC`, Sites Dispatch, or `CONTENT_OS_IDENTITY_TRUST`. The old Sites scaffold remains only as isolated preview/demo material and is not imported by the production build path.

## Local commands

Requirements: Node.js `>=22.13.0`, pnpm `11.25.0`, and the locked dependencies.

```sh
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm start
```

`pnpm dev` starts Vinext development on port 5173. `pnpm start` runs the built Worker locally with Wrangler; it does not deploy.

Create an untracked `.dev.vars` from `.env.example` for local Worker testing. Never use production credentials locally and never prefix server values with `NEXT_PUBLIC_`.

## Worker bindings

Required server-only bindings:

- `CONTENT_OS_SUPABASE_URL`
- `CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY`
- `CONTENT_OS_TELEGRAM_BOT_USERNAME`
- `CONTENT_OS_PERSISTENCE_ENABLED=true` for the persisted Blog review slice
- Google Sheets variables listed in `.env.example` when those views are enabled

The service-role key and database URL must be configured as Worker secrets. No secret or session token is included in browser code. See [the Sprint 10A production-auth contract](docs/SPRINT_10A_CLOUDFLARE_AUTH.md) for the login sequence, trust boundaries, local PostgreSQL 17 rehearsal, and deployment preconditions.

Task Bot is the canonical migration owner. Do not apply the historical Content OS draft migrations independently; migrations `00`–`06` are already present in the Task Bot canonical sequence.

## Production state

This repository is prepared for standalone Cloudflare operation, but this sprint does not authorize a push, deployment, production-secret use, or live migration. `PRODUCTION_RELEASE` remains `HOLD` until the human release gates in the production runbook are approved.
