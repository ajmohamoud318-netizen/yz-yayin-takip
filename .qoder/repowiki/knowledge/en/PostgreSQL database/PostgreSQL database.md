---
kind: external_dependency
name: PostgreSQL database
slug: postgresql
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

- Relational datastore for all application data; accessed via the `pg` driver from the Fastify server.
- Local dev runs a `postgres:16-alpine` container managed by `docker-compose.yml`; production uses a Dokploy-managed Postgres service whose connection string is supplied through `DATABASE_URL`.
- Schema evolves through numbered SQL migrations under `server/db/migrations/` (001–054); migration runner is invoked via `npm run migrate` and can auto-run on boot (`MIGRATE_ON_BOOT`).
- Persistent user uploads are stored on disk at `.yz-uploads` inside the server container and mounted as a named volume (`yzuploads`) in compose.