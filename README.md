# YZ Yayın Takip

[![CI](https://github.com/ajmohamoud318-netizen/yz-yayin-takip/actions/workflows/ci.yml/badge.svg)](https://github.com/ajmohamoud318-netizen/yz-yayin-takip/actions/workflows/ci.yml)

A Vite SPA and Fastify API that moves book projects through the YZ Yayın production pipeline — order intake, demo approval, typesetting, printing and fulfillment — with notifications, web push and an event-sourced audit log. The same `Book Production Pipeline` finite-state machine is implemented twice (authoritative in [`server/src/domain/transitions.js`](server/src/domain/transitions.js), mirrored for optimistic UI in [`client/src/domain/services/pipeline.js`](client/src/domain/services/pipeline.js)) and the test suites in both packages are what keep those two copies in lockstep.

## Local development

The fastest way to get the API, Postgres and the Vite dev server running together is `docker compose`:

```bash
docker compose up --build
```

That brings up three containers on a shared network:

| Container  | Port | Notes                                                            |
| ---------- | ---- | ---------------------------------------------------------------- |
| `postgres` | 5432 | Persisted in the named volume `pgdata`. Auto-bootstrapped.       |
| `server`   | 4000 | Fastify API. Runs migrations + seed on boot (`SEED_ON_BOOT=1`).  |
| `client`   | 5173 | Vite dev server. Proxies `/api/*` → `server`.                    |

Open <http://localhost:5173> for the SPA. The `.env` file at the repo root is read by the `server` container (`DATABASE_URL`, etc.); the client uses Vite's own `.env` loading. Uploaded avatars land in a named volume (`yz_uploads`) so they survive `docker compose down`.

To work against either half directly without Docker, install workspace deps and run the script from the root:

```bash
npm ci                   # installs client/ and server/ workspaces
npm run server           # Fastify dev server on :4000 with --watch
npm run client           # Vite dev server on :5173
```

## Tests

| Command             | Runs                                                  |
| ------------------- | ----------------------------------------------------- |
| `npm test`          | Vitest in `client/` (component + FSM-mirror suite).  |
| `npm run test:server` | `node --test` over `server/src/**/*.test.js`.       |
| `npm run migrate`   | Apply SQL migrations under `server/db/migrations/`.  |
| `npm run seed`      | Insert the seed dataset (requires migrations first).  |

Both test suites run in CI on every push and PR to `main` — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Production image

The root [`Dockerfile`](Dockerfile) builds the Vite SPA and ships `client/dist` + `serve.cjs` as a single `node:20-alpine` image — that image is what Dokploy deploys for the SPA. The API is deployed as a separate service from [`server/Dockerfile`](server/Dockerfile); the compose file above is for dev parity, not production.

## Workspace layout

| Path                    | Stack                              | Notes                                            |
| ----------------------- | ---------------------------------- | ------------------------------------------------ |
| `client/`               | React + Vite + Vitest + Tailwind   | The publishing-tracker UI the team uses every day. |
| `server/`               | Fastify + node --test              | API, auth, events, notifications, file uploads.  |
| `yz-logo-animation/`    | Remotion                           | Standalone logo-animation demo. Not part of the deployable stack. |
