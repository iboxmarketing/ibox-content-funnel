# Sprint 10D — Content OS workflow and login security rules

Status: local commits only. Nothing pushed, deployed, or applied live. Task
Bot (Codex-owned) is the authority for every rule below; Content OS presents
and forwards only what those rules allow, and enforces the same rules in its
own server routes as defence in depth. UI hiding is never the security
boundary.

## 1. Manual tasks vs Content OS workflow tasks

A task is a **Content OS workflow task** when a `content_task_runtime` row
exists for it. Its kind is the **pinned** Task Type version's `code` (`BLOG`,
`HEAD_REVIEW`, …), and its lineage is `source_task_id`. Classification is
read server-side from that persisted provenance
(`lib/workflow-classifier.ts`), never from titles, and fails closed (the
request is refused) if it cannot be read. Every other task is **manual**.

| | Manual task (Sprint 10B rules) | Content OS workflow task |
|---|---|---|
| Creator rights (edit, direct reassign, direct deadline, cancel, review) | yes | **no** — creator is not special |
| Head direct edit / reassign / deadline | yes | yes, subject to the independence rule below |
| Generic lifecycle (accept, block, submit review, approve, cancel, …) | per state machine | **none** — state moves only through the Blog review workflow |
| Assignee deadline / reassign requests | yes | yes, subject to the independence rule |
| Archive / restore | Head | Head; the Task Bot refuses archiving an active Blog / Head Review pair |

The server (`lib/team-task-policy.ts`) computes a `capabilities` object for
every task from the current Task Bot task row, archive state, the actor's
current role, and the workflow classification. `GET /api/team/tasks` returns
it with each task and detail; the UI renders only those controls; every
`POST` re-reads the task and re-checks the same policy before forwarding to
the Task Bot. The actor is always the validated session user — no request
body field can name an actor or creator.

## 2. Head Review independence

- The reviewed Blog's **author** (its current assignee) is never the Head
  Review's reviewer, creator, or decider — Head included.
- The Task Bot's completion RPC records the completing author as the Head
  Review's `creator_id`. That grants nothing: workflow tasks carry no
  creator rights (Task Bot `task_uses_manual_creator_rights`), and the author
  is refused every decision on the review.
- Nobody (Head included) can directly reassign a Head Review to the Blog's
  author, approve a reassignment request that would, or reassign a Blog to
  its own reviewer (`409 WORKFLOW_INDEPENDENCE`).
- **Final review policy (owner decision, Sprint 10E-FIX):** only the active
  **assigned reviewer** approves. Head has no automatic approval right — Head
  approves only while Head is the review's current assignee. The reviewer is
  never the Blog's author, even when the author is Head.

  | Actor | Pick up | Request revision | Approve | Reassign the review |
  |---|---|---|---|---|
  | Assigned reviewer (not the author) | yes | yes | yes | — |
  | Head, not the author, not assigned | — | yes (supervisory), once the reviewer has picked the review up (`IN_PROGRESS`) | **no** | yes (never to the author) |
  | Head, not the author, assigned | yes | yes | yes | yes |
  | Head who wrote the Blog | — | **no** | **no** | yes, to another valid reviewer only |
  | Ordinary Blog author | — | no | no | no |
  | Any other member | — | no | no | no (read only) |

  Content OS enforces this in the server capability policy and in
  `BlogReviewFlow` (the UI renders only server capabilities). The Task Bot
  enforces the same matrix in the database from `3bd2ca7`
  (`task_events_enforce_content_os_head_review_actor`, review-assignment
  independence trigger, `content_os_revision_allowed` requiring an
  `IN_PROGRESS` review): only the assigned reviewer moves the review's own
  lifecycle, so Content OS never picks a review up on a reviewer's behalf.

## 3. Blog completion invariant

`Blog completion ⇒ exactly one Head Review exists.` The only path is the
Task Bot's atomic `content_os_complete_blog_with_head_review` RPC, which
Content OS calls from `BlogReviewFlow.completeBlog` (Sprint 10E): in one
transaction it creates or reuses the Blog's single Head Review and completes
the Blog, or resubmits it and resumes that same review. The Task Bot refuses
any generic `transition(..., 'DONE')` of a Content OS Blog, and Content OS's
generic team-task API refuses all generic lifecycle on workflow tasks. Before
calling, Content OS also refuses a reviewer who is the Blog's author (Head
included — stricter than the Task Bot, which exempts Head) or inactive.
Retries return the same Blog and the same review (key `head-review:<blogTaskId>`).

## 4. Telegram login: matching code and abuse protection

- The browser shows `Kod: 472 851` and "Telegram botdagi kod shu kod bilan bir
  xil bo‘lsa tasdiqlang." The Telegram bot shows the same code. The code is
  for human comparison only; redemption still requires the challenge id, the
  browser-held verifier, the Telegram-authenticated approval, and one-time
  consumption.
- **Task Bot contract (Codex Sprint 10D, aligned against its in-progress
  migration `20261015151900_sprint_10d_workflow_auth_notification_hardening`):**
  `content_os_auth_create_challenge(p_verifier_hash, p_rate_key_hash)`
  returns `display_code` (6 digits) with the challenge, refuses abuse with
  SQLSTATE `PT429` (HTTP 429), and cleans up old challenges; the bot shows
  the same `display_code`. Content OS sends the server-derived rate-key hash
  and maps `PT429` to the neutral rate-limited state. Until that contract is
  deployed, the start call fails and `POST /api/auth/telegram/start` returns
  `503 LOGIN_UNAVAILABLE`; a row without `display_code` is also refused, so a
  code-less login is never started.
- **Rate key (Sprint 10E-FIX):** `rateKeyHash = lowercase hex(HMAC-SHA-256(
  key = CONTENT_OS_RATE_LIMIT_PEPPER, message = "content-os-login-rate-key:v1:"
  + CF-Connecting-IP))` (`lib/auth/rate-key.ts`). The pepper is a Worker
  secret binding (≥ 32 chars). The client IP comes only from Cloudflare's
  `CF-Connecting-IP`; no browser header or body field selects the key. The
  raw IP is never sent to the Task Bot, stored in its auth table, or logged —
  only the 64-hex digest is. In production (https) a missing/short pepper or a
  missing/malformed client IP fails closed (`503 LOGIN_UNAVAILABLE`); there is
  no shared "unknown" bucket. Local development is explicit and
  loopback-only (http on localhost / 127.0.0.1 / [::1]): an obviously named
  development-only pepper and loopback client key are used when the real
  values are absent; any other http origin is refused.
- **Two limits, both enforced:** the Cloudflare edge (Workers Rate Limiting
  binding `LOGIN_START_LIMITER`, 5 per 60 s, keyed `login-start:<rateKeyHash>`;
  a missing binding fails closed) trips before any database call; the Task Bot
  (5 creations per rolling 15 minutes and at most 3 outstanding challenges per
  key) answers `PT429`. Both become a neutral `429 LOGIN_RATE_LIMITED` with
  `Retry-After` (60 s at the edge, 300 s for the Task Bot window); the UI waits
  (clamped to 10–300 s) and never retries automatically.
- Expired, cancelled, consumed and unavailable challenges stop polling and
  discard the verifier; only an explicit "Qaytadan boshlash" creates a new
  challenge. Polling is bounded (1.5 s → 8 s backoff, ≤ 10 minutes, ≤ expiry).
  A blocked popup turns the Telegram link into the primary button.

## 5. Session cookie

Production (https): `__Host-content_os_session` — Secure, HttpOnly, `Path=/`,
no `Domain`, `SameSite=Strict`. Local development over http on a loopback
host only: `content_os_session_dev` (same, without Secure). No session cookie
is issued or accepted on any other plain-http origin, and the login
completion route checks this **before** consuming the challenge. The old
unprefixed `content_os_session` name is no longer accepted.

## 6. Notifications

The Task Bot owns a durable, retryable notification outbox. Content OS sends
no Telegram messages and has no notification system. A committed Task Bot
mutation is reported as success in the UI regardless of delivery state.

## 7. Archive

Archiving cancels the task's pending deadline / reassignment requests;
restore does not revive them (Task Bot-owned). The UI states this, re-reads
authoritative state after every action, and on a conflict (`409`, e.g. an
active Blog / Head Review pair the Task Bot refuses to archive) shows the
reason and refreshes. Content OS does not decide the active-pair rule.

## 8. Cloudflare and cleanup

- `wrangler.jsonc`: `preview_urls: false` for production V1; `workers.dev`
  remains the V1 host. Local `npm run dev` / `npm start` are unaffected.
- Removed: `app/chatgpt-auth.ts`, the SIWC external-actor resolver, and the
  Sites mock-auth Vite plugin. Nothing reads `oai-authenticated-*` headers;
  the production bundle contains none of these identifiers.
- Blog Review API: Task Bot `PT409` business conflicts map to HTTP 409.

## 9. Known limits (documented, not changed here)

- `service_role` blast radius (Sprint 10C M-5): the Content OS Worker still
  holds the service-role key server-side; privileges were not expanded and
  the key never reaches the browser.
- The Content OS checks are defence in depth; the authoritative enforcement of
  decisions 1–3, 5–8 is the Task Bot's (Codex). Until Codex's contract lands,
  the Task Bot's own Telegram / Mini App paths are not covered by these
  Content OS checks.
