---
kind: error_handling
name: HTTP Error Model with Fastify Global Handler and Client Axios Interceptor
category: error_handling
scope:
    - '**'
source_files:
    - server/src/domain/errors.js
    - server/src/index.js
    - server/src/middleware/auth.js
    - client/src/infrastructure/http/client.js
    - client/src/infrastructure/shared/errors.js
    - client/src/components/ErrorBoundary.jsx
    - client/src/application/create-api.js
---

## What system/approach is used

The codebase defines a single, consistent HTTP error model across both the Fastify server and the React SPA:

- **Server-side**: A domain-level `HttpError` class (`server/src/domain/errors.js`) carries `status`, `message`, and a machine-readable `code`. Factory helpers (`badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `gone`) throw typed errors with Turkish user-facing messages. Any thrown `HttpError` is caught by a global Fastify `setErrorHandler` that maps it to a JSON response `{ error, code }` with the correct status. Unhandled exceptions are logged and returned as `500 { error: 'Beklenmeyen sunucu hatası', code: 'internal_error' }`.
- **Client-side**: The axios instance in `client/src/infrastructure/http/client.js` has a response interceptor that rewrites network-timeout / offline failures into Turkish messages, forwards backend `{ error, code }` payloads, and attaches `status`, `offline`, `code`, and `cause` onto the rejected `Error`. A 401 triggers an automatic logout (clears stored token) and redirects to `/login?next=...`. A top-level `ErrorBoundary` component catches render-time throws and shows a friendly card with a reload button; it also auto-reloads once when a stale lazy chunk 404s during a deploy.
- **Shared client helpers**: `client/src/infrastructure/shared/errors.js` exposes the same `notFound`, `badRequest`, `unauthorized`, `forbidden`, `conflict` helpers for use-cases and repositories that need to throw HTTP-flavoured errors without importing axios-specific types.

## Key files and packages

| Area | File | Role |
|---|---|---|
| Server error type | `server/src/domain/errors.js` | `HttpError` class + factory helpers |
| Server bootstrap | `server/src/index.js` | Registers `setErrorHandler`, `unhandledRejection`/`uncaughtException` listeners, graceful shutdown |
| Auth middleware | `server/src/middleware/auth.js` | Throws `unauthorized`/`forbidden` via domain helpers; registers `requireAuth`, `requireRole`, `requireActiveUser` decorators |
| Client HTTP client | `client/src/infrastructure/http/client.js` | Axios instance, request/response interceptors, 401 logout flow |
| Client shared errors | `client/src/infrastructure/shared/errors.js` | Thin `new Error()` + `.status = N` helpers mirroring server helpers |
| Client error boundary | `client/src/components/ErrorBoundary.jsx` | Top-level React error boundary, chunk-stale auto-reload |
| API composition root | `client/src/application/create-api.js` | Wires repositories/use-cases; all downstream callers receive the unified error shape from axios |

## Architecture and conventions

1. **Throw, don't return**: Business logic in routes throws domain errors rather than returning them. Validation failures call `badRequest(...)`, missing resources call `notFound(...)`, authorization failures call `forbidden(...)` or `unauthorized(...)`. This keeps route handlers focused on happy-path mutation and pushes error signaling to a uniform channel.
2. **Global translation layer**: The Fastify `setErrorHandler` is the single place that converts any thrown error into an HTTP response. It recognizes three shapes: `HttpError` instances, plain `Error` objects with a numeric `err.status` (used by client-side helpers that cross the wire), and anything else → 500 with `internal_error`. This means new error types only need to set `.status` to be surfaced correctly.
3. **Machine-readable codes**: Every error response includes a stable `code` field (`bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `gone`, `internal_error`). Callers can branch on codes instead of parsing Turkish messages.
4. **Turkish user messages**: All user-facing strings in error factories and the error boundary are in Turkish (`Yetkisiz erişim`, `Bu işlem için yetkiniz yok`, `Bulunamadı`, `Artık geçerli değil`, `Beklenmeyen sunucu hatası`, `Bir şeyler ters gitti`), keeping UX localized while machine codes stay English.
5. **Client 401 handling is centralized**: The axios response interceptor owns the "session expired" UX — it clears the stored token, removes it from localStorage, and navigates to `/login` with the original path preserved. Callers never implement their own logout-on-401 logic.
6. **Offline vs auth failure distinction**: Network errors (no `response` object) get `offline: true` attached so callers can avoid treating a transient connectivity loss as a sign-out event.
7. **Render-time safety net**: The `ErrorBoundary` wraps the app root so a single broken component cannot blank the entire SPA. It logs the full stack to `console.error` and offers manual reset/reload buttons.
8. **Stale chunk recovery**: During deployments, old lazy-imported chunks disappear. The boundary detects the specific fetch/import failure pattern and auto-reloads once (guarded by `sessionStorage`) so users aren't stuck on a dead page after a deploy.
9. **Process-level crash handling**: The server registers `unhandledRejection` and `uncaughtException` listeners that log to stdout and exit with code 1, ensuring container orchestrators detect boot or runtime crashes.

## Conventions and constraints

- **Domain routes must throw one of the `domain/errors.js` helpers** (or a plain `Error` with `.status` ≥ 400). Anything else becomes a 500 `internal_error` — this is enforced by the global error handler, not by linting.
- **Authorization checks go through `attachUser` / `requireRole` / `requireActiveUser`**, which throw `unauthorized` or `forbidden` using the domain helpers. Routes should not manually check roles and throw ad-hoc errors.
- **Client-side validation errors** should use the `client/src/infrastructure/shared/errors.js` helpers so they carry a `.status` and can be forwarded unchanged through the axios interceptor.
- **No `try/catch` around every repository call** in routes — business rules are expressed as early throws, and the global handler handles the response. Localized `try/catch` is reserved for non-fatal operations (e.g., seed runner, push retry loops).
- **User-visible error text lives in the server**; the client does not translate or localize messages itself — it surfaces whatever the server returns, except for network errors where the interceptor injects a Turkish message.
- **Panic/recover is not used**. Node.js uses structured error propagation via thrown `Error` objects and Promise rejections, handled centrally by Fastify's error handler and process-level listeners.