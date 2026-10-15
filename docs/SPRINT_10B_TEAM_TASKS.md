# Sprint 10B — Content OS Team Tasks

Content OS presents Task Bot's existing task model; it does not own a second task table, request queue, permission system, workflow, or notification dispatcher. The integration target is Task Bot commit `ef249a963e508ba3e5a659a8c2b89686d88c9977`, whose canonical migration 21 adds the authoritative permission/request/archive contract and whose repository reader consumes that migration's events through the canonical domain enum.

## Accepted product decisions

1. Every active marketing user sees every non-archived marketing task.
2. Every active marketing user sees all Content OS content through authenticated server reads.
3. Every active marketing user can create tasks for any active team member.
4. A creator directly edits, reassigns, and reschedules their own task.
5. An ordinary assignee requests reassignment or a deadline change unless they are also the creator.
6. Head directly manages all tasks.
7. Head resolves change requests.
8. Content OS and Telegram resolve the same Task Bot request row.
9. Creators cancel; Head archives/restores.
10. Archive is soft and retains identity, workflow status, links, and complete history.
11. Task Bot sends Telegram notifications for meaningful task, request, revision, review, and approval events.

## Trust and authorization boundaries

The browser holds only the HttpOnly `content_os_session` cookie. `app/api/team/tasks/route.ts` revalidates that opaque session through Task Bot-owned authentication RPCs for every request. The current, active `public.users.id` becomes the actor subject of a server-only HMAC request to Task Bot with provider `CONTENT_OS_TELEGRAM_SESSION`.

Task Bot reloads that user, rechecks current active state and role, then applies its authoritative application and database permissions. Content OS helpers in `lib/team-task-permissions.ts` only control which UI actions are offered; a forged request cannot bypass Task Bot authorization. State-changing browser requests also pass the existing strict same-origin JSON check.

The signing secret is read only by the Worker server route. It is never returned, logged, placed in a `NEXT_PUBLIC_` variable, or imported by a client component. Signed requests cover method, pathname, exact body hash, actor provider, actor subject, and a timestamp with Task Bot's 60-second skew limit. Query parameters are sent normally but, per the shared protocol, are not part of the signed pathname.

## Views and actions

The existing application shell adds one functional `Team Tasks` view:

- **My tasks** — non-archived tasks where the user is creator or assignee.
- **All tasks** — all non-archived team tasks for every active role.
- **Requests** — Head-only view of the shared deadline and reassignment rows, including resolved state.
- **Archived** — Head-only soft-archive view.
- **Create task** — available to every authenticated active role; the assignee picker contains active Task Bot users only.

The detail view shows creator, assignee, status, priority, deadline, context, change-request outcomes, and immutable task history. It refreshes from Task Bot on demand and every 30 seconds; no browser-side cache or mirrored request row determines state.

Relationship behavior:

- Head: direct edit/reassign/deadline, review/cancel/reopen where the Task Bot state machine allows, request resolution, archive, and restore.
- Creator: edit permitted content, direct reassign/deadline, review and cancel where allowed.
- Assignee: assignee workflow transitions and deadline/reassign requests.
- Unrelated team member: read only.
- Self-assigned creator: creator rights win, so changes are direct rather than unnecessary requests.

The Head-facing archive control includes an explicit confirmation and says that “delete” means soft archive. Archived tasks expose no workflow/edit/request actions. Restore calls the Task Bot restore route for the same task id; it never creates a replacement task.

## Server routes

The browser calls only Content OS `GET|POST /api/team/tasks`. The server adapter validates a small discriminated action schema and maps it to Task Bot's exact routes:

- task list/detail and active-user list
- create and permitted content edit
- lifecycle actions
- direct reassignment/deadline
- reassignment/deadline request creation
- shared request approve/reject
- archive/restore

Task Bot `401`, `403`, `409`, and other structured errors retain their status/code at this boundary. A request already resolved through Telegram therefore returns the authoritative conflict rather than creating another decision or task event; the next read displays its resolved state.

## Content visibility

The home page and the Knowledge, catalog/package, production/material, Blog-review, and Team Tasks API routes all require a currently valid Content OS session. The validation RPC denies a deactivated user on their next request. No role-based read filter hides content from an active marketing role, while existing workflow/task ownership checks continue to govern edits. Database service-role access remains server-only.

## Environment contract

Content OS Worker:

```text
TASK_BACKEND_SERVICE_AUTH_ENABLED=true
TASK_BACKEND_BASE_URL=https://<approved-task-bot-origin>
CONTENT_OS_TASK_BACKEND_SECRET=<server-only shared secret>
```

Task Bot:

```text
CONTENT_OS_SERVICE_AUTH_ENABLED=true
CONTENT_OS_SERVICE_SECRET=<same server-only shared secret>
```

Use a generated high-entropy secret and the approved HTTPS origin. Configure secrets through the platform secret store, never a committed file. Enabling either side without its complete configuration fails closed.

## Verification and release boundary

Unit/contract tests cover identity signing, pathname/query handling, client route/payload mapping, strict browser mutation schemas, relationship predicates, server-only secret boundaries, and Task Bot error propagation. `tests/e2e/team-tasks-route.e2e.mjs` proves the seven Sprint 10B flows through the real built Worker and Task Bot against disposable PostgreSQL 17/PostgREST. Its child-process Telegram stub records and acknowledges the real Task Bot dispatcher calls without contacting Telegram; database delivery-ledger assertions still verify `SENT` and dedupe state.

This sprint authorizes no push, deployment, production credentials, live migration, or production-data mutation. `PRODUCTION_RELEASE = HOLD`.
