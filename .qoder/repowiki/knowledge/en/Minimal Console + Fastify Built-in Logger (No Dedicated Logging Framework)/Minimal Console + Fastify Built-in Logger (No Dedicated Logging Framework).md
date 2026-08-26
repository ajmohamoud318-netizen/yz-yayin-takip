---
kind: logging_system
name: Minimal Console + Fastify Built-in Logger (No Dedicated Logging Framework)
category: logging_system
scope:
    - '**'
source_files:
    - server/src/index.js
    - server/src/db/pool.js
    - server/src/services/migrate.js
    - server/src/services/notification-maintenance.js
    - server/src/services/notifications.js
    - server/src/services/mail.js
    - server/src/services/avatars.js
    - server/src/middleware/rate-limit.js
    - server/package.json
---

## What system/approach is used

The repository does **not** use a dedicated logging framework. The server relies on two very light mechanisms:

1. **Fastify's built-in logger** — configured once at boot with `logger: { level: process.env.LOG_LEVEL ?? 'info' }` (`server/src/index.js`). All request/response lifecycle logs, structured fields, and the `request.log.*` API come from Fastify's default pino-based logger.
2. **Bare `console.log/error/warn` calls** scattered across service files for operational messages that are not tied to an HTTP request context (e.g. migration progress, push notification sweep results, file-system errors).

There is no central logger module, no log-level configuration file, no structured-log formatter, no log rotation, and no external sink (no Winston, Bunyan, Pino standalone, Morgan, etc.). The client SPA contains no console output in its source tree.

## Key files and packages

- `server/src/index.js` — Fastify instance creation with `logger.level` sourced from `process.env.LOG_LEVEL`; global error handler uses `request.log.error({ err }, 'unhandled error')`; shutdown path uses `app.log.info({ sig }, 'shutting down')`.
- `server/src/db/pool.js` — PostgreSQL pool emits idle-client errors via `console.error('[pg] ...')`; after-commit hooks catch and log failures with `console.error('[pg] afterCommit hook rejected/threw: ...')`.
- `server/src/services/migrate.js` — prints migration status and applied migrations with `console.log('[migrate] ...')`.
- `server/src/services/notification-maintenance.js` — sweep/cleanup jobs log progress and failures with `console.log('[notifications] ...')` / `console.error('[notifications] ...')`.
- `server/src/services/notifications.js` — push dispatch failures logged via `console.error('[notifications] ...')`.
- `server/src/services/mail.js` — dev-mode dry-run and send failures logged via `console.log` / `console.error`.
- `server/src/services/avatars.js` — filesystem write failures logged via `console.warn` / `console.error`.
- `server/src/middleware/rate-limit.js` — Redis fallbacks logged via `console.error('[rate-limit] ...')`.
- `server/package.json` — dependencies include `fastify` (which ships pino) but no logging library; no `devDependencies` logging package either.

## Architecture and conventions

- **Request-scoped logging**: Normal HTTP request/response logging is delegated entirely to Fastify's logger. Application code never instantiates its own logger; it calls `request.log.error(...)` or `app.log.info(...)` (see `index.js` error handler and shutdown). Structured fields are passed as the first argument object (e.g. `{ err }`, `{ sig }`), which Fastify/pino serializes into JSON lines.
- **Non-request logging**: Operational events outside the request pipeline (DB pool errors, migration steps, background sweeps, file I/O) use tagged `console.*` strings such as `[pg]`, `[server]`, `[rate-limit]`, `[mail]`, `[migrate]`, `[notifications]`, `[avatars]`. These tags act as a crude category filter since there is no structured `service` field.
- **Log levels**: Only one explicit level exists — `LOG_LEVEL` environment variable defaults to `'info'` when constructing the Fastify instance. There is no per-module level control and no runtime level switching.
- **Error handling vs logging**: Domain errors thrown as `HttpError` are converted to JSON responses by the global error handler; non-domain errors are logged via `request.log.error({ err }, 'unhandled error')` and return a generic 500. Unhandled rejections and uncaught exceptions are caught at the process level and written to stderr via `console.error('[server] unhandledRejection/uncaughtException/boot failed: ...')` so they always reach `docker logs`.
- **Structured fields**: Only the Fastify logger path produces structured JSON; `console.*` calls emit plain text with a bracketed tag prefix. There is no shared schema for those tags.

## Conventions and constraints

Observed patterns (descriptive):
- Every `console.error` call in the server is preceded by a `[tag]` prefix identifying the subsystem (e.g. `[pg]`, `[server]`, `[rate-limit]`, `[mail]`, `[migrate]`, `[notifications]`, `[avatars]`).
- After-commit side effects (push notifications, emails, webhooks) are wrapped in try/catch inside `withTx` and any failure is logged via `console.error` rather than propagated — the comment explicitly states "errors are swallowed, nothing is awaited" so post-commit work cannot break the response.
- Background maintenance tasks (`notification-maintenance`) log both success summaries and failures; failures do not throw because they run on timers detached from request handlers.
- The client SPA has no logging code in `client/src`; all user-facing errors are surfaced through UI components (e.g. `ErrorBoundary.jsx`) rather than emitted to the console.

Enforced rules (from code/comments):
- Boot-time failures must be visible to `docker logs`: `unhandledRejection`, `uncaughtException`, and the initial `main()` rejection are all caught and written to stderr via `console.error('[server] ...')` (enforced by the guard block at the bottom of `server/src/index.js`).
- Post-commit hooks must not crash the response: the `withTx` implementation wraps each hook in try/catch and swallows errors, documented in the module JSDoc and enforced by the `setImmediate` wrapper around each callback.
- Idle PostgreSQL client errors must not crash the server: the pool's `'error'` event handler logs via `console.error` without rethrowing (enforced in `server/src/db/pool.js`).